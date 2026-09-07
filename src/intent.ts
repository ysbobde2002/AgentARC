import type { Intent, ServiceCategory } from "./types.js";

const SPEND = /(?:spend|budget|max(?:imum)?(?: spend)?|up to|under|no more than)\s*\$?\s*([\d,.]+)/i;
const DOLLAR = /\$\s*([\d,.]+)/;

export function parseIntent(raw: string, fallbackMax?: number): Intent {
  const text = raw.trim();
  const spendMatch = text.match(SPEND) || text.match(DOLLAR);
  const parsedSpend = spendMatch ? Number(spendMatch[1].replace(/,/g, "")) : NaN;

  const research = /research|memo|report|analysis|brief/i.test(text);
  const market = /price|eth|btc|market|ticker|quote|chart|ohlc|candle/i.test(text);
  const shopping =
    /chocolate|chocolates|shoe|shoes|umbrella|rain|gift|shopify|buy me|find me|order/i.test(text) &&
    !research &&
    !market;

  let serviceType: ServiceCategory | "unknown" = "unknown";
  if (research) serviceType = "research";
  else if (market) serviceType = "financial-data";
  else if (shopping) serviceType = "commerce";

  let asset = "ETH";
  if (/\bbtc\b|bitcoin/i.test(text)) asset = "BTC";

  const maxSpendUsd = Number.isFinite(parsedSpend)
    ? parsedSpend
    : fallbackMax ?? (serviceType === "commerce" ? 50 : 0.05);

  return {
    raw: text,
    serviceType,
    asset,
    maxSpendUsd,
    currency: "USDC",
    channel: serviceType === "commerce" ? "shopify" : "digital",
  };
}
