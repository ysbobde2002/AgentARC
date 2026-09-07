import type { Service } from "./types.js";
import { parseIntent } from "./intent.js";
import { captureTurn } from "./intent/capture.js";
import { CIRCLE_CATEGORIES } from "./marketplace.js";
import { SELLER_ROUTES, sellerCatalogListings } from "./seller/catalog.js";
import { discoverShopify } from "./ucp.js";

export const SERVICES: Service[] = SELLER_ROUTES.map((r) => r.service);

export function isHistoricalPrompt(raw: string) {
  return /\b(20\d{2}|yesterday|historical|on \d{1,2}|at \d{1,2}\s*(am|pm)|9\s*am|9\s*pm)\b/i.test(raw);
}

export function sellerCoversIntent(intent: { serviceType: string; asset: string; raw: string }) {
  if (intent.serviceType !== "financial-data") return true;
  if (intent.asset !== "ETH" || /\b(btc|bitcoin)\b/i.test(intent.raw)) return false;
  if (isHistoricalPrompt(intent.raw)) return false;
  return true;
}

export function discoverService(serviceType: string, asset: string, raw = ""): Service | null {
  if (serviceType === "research") {
    return SERVICES.find((s) => s.category === "research") ?? null;
  }
  if (serviceType === "financial-data") {
    if (/ohlc|candle|chart/i.test(raw)) {
      return SERVICES.find((s) => s.id === "market-data-eth-ohlc") ?? null;
    }
    return SERVICES.find((s) => s.id === "market-data-eth") ?? SERVICES.find((s) => s.category === "financial-data") ?? null;
  }
  if (serviceType === "commerce") return null;
  return SERVICES[0] ?? null;
}

function localDigitalCatalog() {
  const listings = sellerCatalogListings();
  return {
    listings,
    total: listings.length,
    source: "live" as const,
    deterministic: true as const,
    endpoint: "/catalog",
    fetchedAt: new Date().toISOString(),
  };
}

export async function discoverCatalog(prompt: string) {
  const intent = parseIntent(prompt);
  const digital = intent.serviceType === "commerce" ? { ...localDigitalCatalog(), listings: [] } : localDigitalCatalog();
  const shopify =
    intent.serviceType === "commerce"
      ? await discoverShopify(prompt, 5)
      : { products: [], source: "fallback" as const };
  return {
    intent,
    digital: digital.listings.slice(0, 5),
    digitalMeta: {
      source: digital.source,
      deterministic: digital.deterministic,
      total: digital.total,
      shown: Math.min(5, digital.listings.length),
      endpoint: digital.endpoint,
      fetchedAt: digital.fetchedAt,
      note: "Arc x402 seller on this host. Circle Agent Marketplace is a price-band signal only — it is not the payTo.",
    },
    shopify: shopify.products.slice(0, 5),
    shopifySource: shopify.source,
  };
}

export async function runTurn(input: { prompt: string; sessionId?: string | null; category?: string }) {
  if (input.category) {
    const catalog = localDigitalCatalog();
    return {
      sessionId: null,
      stopReason: "ready" as const,
      ready: true,
      agentMessage: "Arc Chart Seller listings on Arc testnet (HTTP 402 until paid in USDC).",
      options: [],
      provider: "seller-catalog",
      parsed: {
        raw: input.prompt || input.category,
        query: input.category,
        channel: "digital" as const,
        category: "FINANCIAL_ANALYSIS",
        serviceType: "financial-data" as const,
        asset: "ETH",
        maxPriceCents: 5,
        maxSpendUsd: 0.05,
      },
      shopify: [],
      shopifySource: "fallback" as const,
      digital: catalog.listings,
      digitalMeta: {
        source: catalog.source,
        total: catalog.total,
        shown: catalog.listings.length,
        category: "FINANCIAL_ANALYSIS",
        endpoint: catalog.endpoint,
        fetchedAt: catalog.fetchedAt,
        pickIndex: 0,
      },
      categories: CIRCLE_CATEGORIES,
    };
  }

  const turn = await captureTurn({ prompt: input.prompt, sessionId: input.sessionId });
  if (!turn.ready) {
    return {
      ...turn,
      shopify: [],
      digital: [],
      digitalMeta: null,
      categories: CIRCLE_CATEGORIES,
    };
  }

  const parsed = turn.parsed;
  const shopify =
    parsed.channel === "shopify"
      ? await discoverShopify(parsed.query || input.prompt, 5, parsed.maxPriceCents)
      : { products: [], source: "fallback" as const };
  const digital = parsed.channel === "digital" ? localDigitalCatalog() : { listings: [] as ReturnType<typeof sellerCatalogListings>, total: 0, source: "unavailable" as const, endpoint: "", fetchedAt: new Date().toISOString() };

  return {
    ...turn,
    shopify: shopify.products.slice(0, 5),
    shopifySource: shopify.source,
    digital: digital.listings.slice(0, 5),
    digitalMeta: {
      source: digital.source,
      total: digital.total,
      shown: Math.min(5, digital.listings.length),
      category: parsed.category,
      endpoint: digital.endpoint,
      fetchedAt: digital.fetchedAt,
      pickIndex: 0,
    },
    categories: CIRCLE_CATEGORIES,
  };
}
