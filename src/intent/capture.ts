import { randomUUID } from "node:crypto";
import { CIRCLE_CATEGORIES, type CircleCategory } from "../marketplace.js";
import { chatJson, openaiConfigured, parseIntentJson } from "./openai.js";

export type Channel = "shopify" | "digital";

export type Requirements = {
  query: string;
  maxPriceCents: number | null;
  channel: Channel | null;
  category: CircleCategory | null;
  serviceType: string;
};

type Session = {
  id: string;
  history: Array<{ role: string; content: string }>;
  requirements: Requirements;
  lastChipOptions: string[];
};

type ParsedTurn = {
  query: string;
  maxPriceCents: number | null;
  options: string[];
  response_message: string;
  channel: Channel | null;
  category: CircleCategory | null;
  serviceType: string;
};

const SYSTEM = `You are ARC Agent, a buyer agent on Circle Arc. You shop Shopify UCP for physical goods and Circle x402 for digital services. You never take card numbers, private keys, or MetaMask. Payment is USDC from the user's Circle Agent Wallet after they approve.

This is a back-and-forth. One turn = one short sentence (or a search confirmation). Do not search catalogs yourself.

Channels:
- shopify: chocolates, gifts, physical products
- digital: ETH price, research memos, Circle marketplace categories

Circle categories: CREATIVE, DATA_ENRICHMENT, FINANCIAL_ANALYSIS, INFRASTRUCTURE, PREDICTION_MARKETS, SOCIAL_INTELLIGENCE, WEB_SEARCH_RESEARCH.

Turn protocol:
0. Greeting / vague → ask what they want. query empty. options = 2–3 choices.
1. Product named, no budget (Shopify) → set query + channel=shopify. Ask "What's your budget?" with options like ["$5","$8","$12"]. Never say "$N chips".
2. Product AND budget already in the same message ("chocolates under $10") → set query, max_price, channel=shopify, ready. Do not ask for budget.
3. "ETH price" / ticker → channel=digital, service_type=financial-data, category=FINANCIAL_ANALYSIS, default max_price 0.05 if none given, ready.
4. "research memo" → channel=digital, service_type=research, default max_price 150 if they said $150+, ready.
5. A Circle category name → channel=digital, that category, ready (budget optional).

Return JSON only:
{
 "query": "short searchable phrase or empty",
 "max_price": null or number in USD,
 "options": ["choice A", "choice B"],
 "response_message": "one short sentence",
 "channel": "shopify" | "digital" | "",
 "category": "FINANCIAL_ANALYSIS" | "" | other Circle category,
 "service_type": "commerce" | "financial-data" | "research" | "unknown"
}`;

const CATEGORY_SET = new Set<string>(CIRCLE_CATEGORIES.map((c) => c.id));

function emptyRequirements(): Requirements {
  return { query: "", maxPriceCents: null, channel: null, category: null, serviceType: "unknown" };
}

function dollarsToCents(value: unknown) {
  const n = Number(value);
  if (!Number.isFinite(n) || n <= 0) return null;
  return Math.round(n * 100);
}

function extractBudgetCents(text: string) {
  const under = text.match(/\b(?:under|below|less\s+than|max(?:imum)?|budget|up to|spend)\s*\$?\s*(\d+(?:\.\d{1,2})?)\b/i);
  if (under) return Math.round(Number(under[1]) * 100);
  const dollar = text.match(/\$\s*(\d+(?:\.\d{1,2})?)/);
  if (dollar) return Math.round(Number(dollar[1]) * 100);
  const bare = text.match(/^\s*(\d+(?:\.\d{1,2})?)\s*(?:usd|dollars?)?\s*$/i);
  if (bare) return Math.round(Number(bare[1]) * 100);
  return null;
}

function looksLikeBudgetChip(opt: string) {
  const s = String(opt || "").trim();
  return /^\$?\s*\d+(?:\.\d{1,2})?\s*(?:usd|dollars?)?$/i.test(s) || /\b(?:under|below|max)\s+\$?\s*\d+/i.test(s);
}

export function isGreeting(text: string) {
  return /^(hola|hi+|hey+|hello|yo+|sup|what'?s up|howdy|gm|good (morning|afternoon|evening))[\s!?.]*$/i.test(
    String(text || "").trim(),
  );
}

function isSearchableQuery(query: string) {
  const q = String(query || "").trim();
  if (q.length < 3) return false;
  if (/^(help|something|stuff|idk|gift)$/i.test(q)) return false;
  return true;
}

function suggestBudgetChips(query: string) {
  const q = String(query || "").toLowerCase();
  if (/\b(candy|candies|chocolates?|snack|gum|sweets?)\b/.test(q)) return ["$5", "$8", "$12"];
  if (/\b(flower|bouquet)\b/.test(q)) return ["$20", "$35", "$50"];
  return ["$15", "$30", "$50"];
}

function asCategory(raw: string | null | undefined): CircleCategory | null {
  const id = String(raw || "").trim().toUpperCase().replace(/\s+/g, "_");
  return CATEGORY_SET.has(id) ? (id as CircleCategory) : null;
}

function detectCategory(text: string): CircleCategory | null {
  const t = text.toLowerCase();
  if (/creative|image gen|dall/i.test(t)) return "CREATIVE";
  if (/enrichment|enrich data/i.test(t)) return "DATA_ENRICHMENT";
  if (/financial|price|ticker|eth|btc|market data/i.test(t)) return "FINANCIAL_ANALYSIS";
  if (/infrastructure|rpc|hosting|cdn/i.test(t)) return "INFRASTRUCTURE";
  if (/prediction|polymarket|odds/i.test(t)) return "PREDICTION_MARKETS";
  if (/social intelligence|twitter|sentiment/i.test(t)) return "SOCIAL_INTELLIGENCE";
  if (/web search|research memo|scrape/i.test(t)) return "WEB_SEARCH_RESEARCH";
  return null;
}

function parseWithRegex(text: string, prior: Requirements): ParsedTurn {
  const budget = extractBudgetCents(text);
  const cat = detectCategory(text);
  const shopping =
    /chocolate|flower|wine|umbrella|shopify|gift/i.test(text) ||
    ((/buy me|find me|order/i.test(text)) && !/eth|btc|price|ticker|memo|research|x402|circle/i.test(text));
  const research = /research memo|memo|brief|report/i.test(text) && !shopping;
  const market = /eth|btc|price|ticker|quote/i.test(text) && !shopping;
  const catalog = /circle|x402|catalog|listings/i.test(text);

  let channel: Channel | null = prior.channel;
  let query = prior.query;
  let serviceType = prior.serviceType;
  let category = prior.category || cat;
  let options: string[] = [];
  let response_message = "";

  if (isGreeting(text) && !prior.query) {
    return {
      query: "",
      maxPriceCents: null,
      options: ["chocolates", "ETH price", "research memo"],
      response_message: "Hey — what should I get?",
      channel: null,
      category: null,
      serviceType: "unknown",
    };
  }

  if (shopping) {
    channel = "shopify";
    serviceType = "commerce";
    if (/chocolate/i.test(text)) query = "chocolates";
    else if (/flower/i.test(text)) query = "flowers";
    else if (/umbrella/i.test(text)) query = "umbrella";
    else if (isSearchableQuery(text) && !query) query = text.replace(/find me|buy me|under.+$/gi, "").trim();
  } else if (research) {
    channel = "digital";
    serviceType = "research";
    query = query || "ETH research";
    category = "WEB_SEARCH_RESEARCH";
  } else if (market) {
    channel = "digital";
    serviceType = "financial-data";
    query = query || "ETH price";
    category = "FINANCIAL_ANALYSIS";
  } else if (catalog || cat) {
    channel = "digital";
    serviceType = cat === "WEB_SEARCH_RESEARCH" ? "research" : "financial-data";
    query = query || (cat ? cat.replace(/_/g, " ").toLowerCase() : "circle services");
    category = cat || category;
  }

  const maxPriceCents = budget || prior.maxPriceCents;
  const digitalReady = channel === "digital" && Boolean(query);
  const shopReady = channel === "shopify" && isSearchableQuery(query) && Boolean(maxPriceCents);

  if (channel === "shopify" && isSearchableQuery(query) && !maxPriceCents) {
    options = suggestBudgetChips(query);
    response_message = `What's your budget for ${query}?`;
  } else if (digitalReady) {
    response_message = `On it — searching Circle ${category?.replace(/_/g, " ") || "listings"} for "${query}".`;
  } else if (shopReady) {
    response_message = `Searching Shopify for "${query}" under $${((maxPriceCents || 0) / 100).toFixed(0)}.`;
  } else if (!query) {
    options = ["chocolates", "ETH price", "research memo"];
    response_message = "What should I order?";
  } else {
    response_message = "Got it.";
  }

  return {
    query,
    maxPriceCents: budget,
    options,
    response_message,
    channel,
    category,
    serviceType,
  };
}

function merge(prior: Requirements, next: ParsedTurn): Requirements {
  return {
    query: isSearchableQuery(next.query) ? next.query.trim() : prior.query,
    maxPriceCents: next.maxPriceCents && next.maxPriceCents > 0 ? next.maxPriceCents : prior.maxPriceCents,
    channel: next.channel || prior.channel,
    category: next.category || prior.category,
    serviceType: next.serviceType && next.serviceType !== "unknown" ? next.serviceType : prior.serviceType,
  };
}

function missingFields(req: Requirements) {
  const missing: string[] = [];
  if (req.channel === "shopify") {
    if (!isSearchableQuery(req.query)) missing.push("query");
    if (!req.maxPriceCents) missing.push("budget");
  } else if (req.channel === "digital") {
    if (!isSearchableQuery(req.query) && !req.category) missing.push("query");
  } else {
    missing.push("query");
  }
  return missing;
}

function applyStatedConstraints(parsed: ParsedTurn, prompt: string): ParsedTurn {
  const next = { ...parsed };
  const stated = extractBudgetCents(prompt);
  if (stated) next.maxPriceCents = stated;
  if (/chocolate/i.test(prompt)) {
    next.query = isSearchableQuery(next.query) ? next.query : "chocolates";
    next.channel = "shopify";
    next.serviceType = "commerce";
  } else if (/flower/i.test(prompt)) {
    next.query = isSearchableQuery(next.query) ? next.query : "flowers";
    next.channel = next.channel || "shopify";
    next.serviceType = "commerce";
  }
  if (/eth|btc|price|ticker/i.test(prompt) && next.channel !== "shopify") {
    next.channel = "digital";
    next.serviceType = next.serviceType === "research" ? "research" : "financial-data";
    next.category = next.category || "FINANCIAL_ANALYSIS";
    next.query = isSearchableQuery(next.query) ? next.query : "ETH price";
  }
  return next;
}

function applyChipReply(parsed: ParsedTurn, prompt: string, last: string[]): ParsedTurn {
  const chip = last.find((o) => o.trim().toLowerCase() === prompt.trim().toLowerCase());
  if (!chip) return parsed;
  if (looksLikeBudgetChip(chip)) {
    return { ...parsed, maxPriceCents: parsed.maxPriceCents || extractBudgetCents(chip) };
  }
  if (!isSearchableQuery(parsed.query)) return { ...parsed, query: chip };
  return parsed;
}

const sessions = new Map<string, Session>();

function getOrCreate(sessionId?: string | null): Session {
  if (sessionId && sessions.has(sessionId)) return sessions.get(sessionId)!;
  const session: Session = {
    id: randomUUID(),
    history: [],
    requirements: emptyRequirements(),
    lastChipOptions: [],
  };
  sessions.set(session.id, session);
  return session;
}

async function parseWithOpenAI(text: string, session: Session): Promise<ParsedTurn> {
  const history = session.history.slice(-8).map((m) => ({
    role: m.role === "assistant" ? "assistant" : "user",
    content: m.content,
  }));
  const prior = `Known: query=${session.requirements.query || "(none)"}; budget=${
    session.requirements.maxPriceCents ? "$" + (session.requirements.maxPriceCents / 100).toFixed(0) : "(none)"
  }; channel=${session.requirements.channel || "(none)"}.`;
  const json = await chatJson({
    system: `${SYSTEM}\n${prior}`,
    messages: [...history, { role: "user", content: text }],
  });
  const intent = parseIntentJson(json);
  return {
    query: intent.query,
    maxPriceCents: dollarsToCents(intent.max_price),
    options: intent.options,
    response_message: intent.response_message,
    channel: intent.channel === "shopify" || intent.channel === "digital" ? intent.channel : null,
    category: asCategory(intent.category),
    serviceType: intent.service_type || "unknown",
  };
}

export async function captureTurn({ sessionId, prompt }: { sessionId?: string | null; prompt: string }) {
  const session = getOrCreate(sessionId);
  session.history.push({ role: "user", content: prompt });

  let parsed: ParsedTurn;
  let provider: "openai" | "regex" = "regex";
  if (openaiConfigured() && process.env.VITEST !== "true") {
    try {
      parsed = await parseWithOpenAI(prompt, session);
      provider = "openai";
    } catch {
      parsed = parseWithRegex(prompt, session.requirements);
    }
  } else {
    parsed = parseWithRegex(prompt, session.requirements);
  }

  parsed = applyChipReply(parsed, prompt, session.lastChipOptions);
  parsed = applyStatedConstraints(parsed, prompt);

  session.requirements = merge(session.requirements, parsed);
  if (session.requirements.channel === "digital" && !session.requirements.maxPriceCents) {
    session.requirements.maxPriceCents =
      session.requirements.serviceType === "research" ? 15000 : 5;
  }

  const missing = missingFields(session.requirements);
  const ready = missing.length === 0;
  const options = ready
    ? []
    : missing[0] === "budget"
      ? suggestBudgetChips(session.requirements.query)
      : (parsed.options || []).slice(0, 3);
  session.lastChipOptions = options;

  const agentMessage = ready
    ? session.requirements.channel === "shopify"
      ? `Searching Shopify for "${session.requirements.query}" under $${((session.requirements.maxPriceCents || 0) / 100).toFixed(0)}.`
      : parsed.response_message && !/budget/i.test(parsed.response_message)
        ? parsed.response_message
        : `Searching Circle for "${session.requirements.query || session.requirements.category}".`
    : missing[0] === "budget"
      ? `What's your budget for ${session.requirements.query || "that"}?`
      : parsed.response_message && !/\$N chips/i.test(parsed.response_message)
        ? parsed.response_message
        : "What should I get?";
  session.history.push({ role: "assistant", content: agentMessage });

  return {
    sessionId: session.id,
    stopReason: ready ? ("ready" as const) : ("needs_clarification" as const),
    agentMessage,
    options,
    parsed: {
      raw: prompt,
      query: session.requirements.query,
      intent: prompt,
      maxPriceCents: session.requirements.maxPriceCents,
      maxSpendUsd: (session.requirements.maxPriceCents || 0) / 100,
      channel: session.requirements.channel,
      category: session.requirements.category,
      serviceType: session.requirements.serviceType,
      asset: /\bbtc\b|bitcoin/i.test(session.requirements.query + prompt) ? "BTC" : "ETH",
    },
    missing,
    provider,
    ready,
  };
}

export function resetIntentSession(sessionId?: string | null) {
  if (sessionId) sessions.delete(sessionId);
}
