import { fromAtomicUsdc } from "./circle/chain.js";
import { config } from "./config.js";
import type { Service } from "./types.js";

export type MarketplaceListing = {
  resource: string;
  name: string;
  category: string;
  description: string;
  priceUsd: number | null;
  supportsCircleGateway: boolean;
  supportsVanillax402: boolean;
  networks: string[];
  advertisedNetwork?: string | null;
  method?: string;
};

export type MarketplaceCatalog = {
  listings: MarketplaceListing[];
  total: number;
  source: "live" | "unavailable";
  deterministic: false;
  endpoint: string;
  fetchedAt: string;
};

export const MATCH_LIMIT = 5;

export const CIRCLE_CATEGORIES = [
  { id: "CREATIVE", label: "Creative" },
  { id: "DATA_ENRICHMENT", label: "Data Enrichment" },
  { id: "FINANCIAL_ANALYSIS", label: "Financial Analysis" },
  { id: "INFRASTRUCTURE", label: "Infrastructure" },
  { id: "PREDICTION_MARKETS", label: "Prediction Markets" },
  { id: "SOCIAL_INTELLIGENCE", label: "Social Intelligence" },
  { id: "WEB_SEARCH_RESEARCH", label: "Web Search Research" },
] as const;

export type CircleCategory = (typeof CIRCLE_CATEGORIES)[number]["id"];

const DISCOVERY = "https://api.circle.com/v2/x402/discovery/resources";
const STOP = new Set([
  "the", "and", "for", "with", "from", "that", "this", "find", "show", "give",
  "get", "buy", "me", "my", "a", "an", "of", "to", "up", "under", "spend",
  "please", "current", "circle", "x402", "listings", "catalog", "live", "want",
]);

export async function discoverMarketplace(input: {
  query?: string;
  category?: string;
  limit?: number;
} = {}): Promise<MarketplaceCatalog> {
  const params = new URLSearchParams();
  params.set("limit", String(input.limit ?? 50));
  const category =
    input.category && input.category !== "DATA_ENRICHMENT" ? input.category : undefined;
  const query =
    input.category === "DATA_ENRICHMENT" ? input.query || "enrichment" : input.query;
  if (query) params.set("query", query);
  if (category) params.set("category", category);
  const endpoint = `${DISCOVERY}?${params.toString()}`;

  try {
    const res = await fetch(endpoint, {
      headers: { Accept: "application/json" },
      signal: AbortSignal.timeout(8000),
    });
    if (!res.ok) {
      return {
        listings: [],
        total: 0,
        source: "unavailable",
        deterministic: false,
        endpoint,
        fetchedAt: new Date().toISOString(),
      };
    }
    const json = (await res.json()) as {
      items?: Array<{
        resource: string;
        accepts?: Array<{ amount?: string; network?: string }>;
        metadata?: {
          provider?: { name?: string; category?: string; description?: string };
          description?: string;
          method?: string;
          supportsCircleGateway?: boolean;
          supportsVanillax402?: boolean;
        };
      }>;
      pagination?: { total?: number };
    };
    const listings = (json.items ?? []).map((item) => {
      const accepted = item.accepts?.[0];
      const amount = accepted?.amount;
      const priced = amount != null && Number(amount) > 0;
      return {
        resource: item.resource,
        name: item.metadata?.provider?.name || item.resource,
        category: item.metadata?.provider?.category || "UNKNOWN",
        description: item.metadata?.description || item.metadata?.provider?.description || "",
        priceUsd: priced ? fromAtomicUsdc(amount, 6) : Number(amount) === 0 ? 0 : null,
        supportsCircleGateway: Boolean(item.metadata?.supportsCircleGateway),
        supportsVanillax402: Boolean(item.metadata?.supportsVanillax402),
        networks: [...new Set((item.accepts ?? []).map((a) => a.network || "").filter(Boolean))],
        advertisedNetwork: accepted?.network || null,
        method: item.metadata?.method || "GET",
      };
    });
    return {
      listings,
      total: json.pagination?.total ?? listings.length,
      source: "live",
      deterministic: false,
      endpoint,
      fetchedAt: new Date().toISOString(),
    };
  } catch {
    return {
      listings: [],
      total: 0,
      source: "unavailable",
      deterministic: false,
      endpoint,
      fetchedAt: new Date().toISOString(),
    };
  }
}

export function intentTokens(prompt: string, extra: string[] = []): string[] {
  const raw = prompt
    .toLowerCase()
    .replace(/[^a-z0-9.\s-]/g, " ")
    .split(/\s+/)
    .filter((t) => t.length > 2 && !STOP.has(t) && !/^\$?\d/.test(t));
  return [...new Set([...raw, ...extra.map((t) => t.toLowerCase()).filter(Boolean)])];
}

function tokenHit(hay: string, token: string): boolean {
  const escaped = token.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(`(^|[^a-z0-9])${escaped}([^a-z0-9]|$)`).test(hay);
}

export function searchQuery(prompt: string, intent: { serviceType: string; asset: string; category?: string | null }): string | undefined {
  if (intent.category === "DATA_ENRICHMENT") return "enrichment";
  if (intent.serviceType === "financial-data") {
    return [intent.asset, "price"].filter(Boolean).join(" ");
  }
  if (intent.serviceType === "research") return `${intent.asset} research`.trim();
  const tokens = intentTokens(prompt);
  return tokens.slice(0, 4).join(" ") || undefined;
}

export function rankListings(
  listings: MarketplaceListing[],
  prompt: string,
  intent: { serviceType: string; asset: string },
  limit = MATCH_LIMIT,
): MarketplaceListing[] {
  const tokens = intentTokens(prompt, intent.asset ? [intent.asset] : []);
  const scored = listings.map((listing) => {
    const hay = `${listing.name} ${listing.description} ${listing.category} ${listing.resource}`.toLowerCase();
    let score = tokens.reduce((n, t) => n + (tokenHit(hay, t) ? 3 : 0), 0);
    if (intent.serviceType === "financial-data" && listing.category === "FINANCIAL_ANALYSIS") score += 4;
    if (intent.serviceType === "financial-data" && /price|ticker|quote|ohlc|market/i.test(hay)) score += 5;
    if (intent.serviceType === "research" && /research|search|report/i.test(`${listing.category} ${listing.description}`)) {
      score += 4;
    }
    if (listing.priceUsd != null && listing.priceUsd > 0) score += 1;
    return { listing, score };
  });
  scored.sort((a, b) => b.score - a.score);
  const matched = scored.filter((row) => row.score > 0);
  return (matched.length ? matched : scored).slice(0, limit).map((row) => row.listing);
}

export async function discoverMatchingListings(
  prompt: string,
  intent: { serviceType: string; asset: string; category?: string | null },
): Promise<MarketplaceCatalog> {
  const query = searchQuery(prompt, intent);
  const category = intent.category && intent.category !== "DATA_ENRICHMENT" ? intent.category : undefined;
  let catalog = await discoverMarketplace({ query, category, limit: 50 });
  let listings = rankListings(catalog.listings, prompt, intent, MATCH_LIMIT);
  if (listings.length < MATCH_LIMIT) {
    const wider = await discoverMarketplace({
      category,
      query: intent.category === "DATA_ENRICHMENT" ? "enrichment" : undefined,
      limit: 50,
    });
    listings = rankListings(wider.listings, prompt, intent, MATCH_LIMIT);
    catalog = wider;
  }
  return { ...catalog, listings };
}

export function marketplacePriceBand(listings: MarketplaceListing[]): {
  medianUsd: number | null;
  sample: number;
} {
  const prices = listings.map((l) => l.priceUsd).filter((n): n is number => n != null && n > 0);
  if (!prices.length) return { medianUsd: null, sample: 0 };
  prices.sort((a, b) => a - b);
  const mid = Math.floor(prices.length / 2);
  const median = prices.length % 2 ? prices[mid]! : (prices[mid - 1]! + prices[mid]!) / 2;
  return { medianUsd: median, sample: prices.length };
}

/** Circle catalog is a price-band signal. Purchases always settle with the local Arc x402 seller. */
export function listingToService(listing: MarketplaceListing): Service {
  const path = listing.resource.startsWith("/") ? listing.resource : "/charts/ETH";
  const ohlc = /ohlc/i.test(path) || /ohlc|candle/i.test(`${listing.description} ${listing.name}`);
  const priceUsd =
    listing.priceUsd != null && listing.priceUsd > 0 && listing.priceUsd < 1
      ? listing.priceUsd
      : ohlc
        ? 0.02
        : 0.01;
  return {
    id: ohlc ? "market-data-eth-ohlc" : "market-data-eth",
    name: listing.description || listing.name,
    category: "financial-data",
    endpoint: path.startsWith("/charts") ? path : ohlc ? "/charts/ETH/ohlc" : "/charts/ETH",
    priceUsd,
    currency: "USDC",
    network: "Arc",
    sellerAgentId: config.identity.sellerAgentId,
    delivery: "instant",
    objective: true,
  };
}

export function catalogNote(catalog: MarketplaceCatalog) {
  return {
    source: catalog.source,
    deterministic: catalog.deterministic,
    shown: catalog.listings.length,
    total: catalog.total,
    endpoint: catalog.endpoint,
    settlement: `${config.arc.name} · advertised payTo is not Arc`,
  };
}
