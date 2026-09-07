export type Quote = {
  service: "market-data" | "research";
  asset: string;
  price: number;
  change24h: number;
  timestamp: string;
  requestId: string;
  summary?: string;
};

async function fetchLiveEth(): Promise<{ price: number; change24h: number } | null> {
  try {
    const res = await fetch(
      "https://api.coingecko.com/api/v3/simple/price?ids=ethereum&vs_currencies=usd&include_24hr_change=true",
      { signal: AbortSignal.timeout(2500) },
    );
    if (!res.ok) return null;
    const json = (await res.json()) as {
      ethereum?: { usd?: number; usd_24h_change?: number };
    };
    const price = json.ethereum?.usd;
    if (!price) return null;
    return { price, change24h: json.ethereum?.usd_24h_change ?? 0 };
  } catch {
    return null;
  }
}

function requestId() {
  return `req_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

export async function getMarketQuote(asset: string, fail: boolean): Promise<{
  httpStatus: number;
  body: Record<string, unknown>;
  requestId: string;
}> {
  const id = requestId();
  if (fail) {
    return {
      httpStatus: 200,
      requestId: id,
      body: { service: "market-data", asset, error: "malformed" },
    };
  }
  const live = asset === "ETH" ? await fetchLiveEth() : null;
  const price = live?.price ?? 4218.32;
  const change24h = Number((live?.change24h ?? 2.14).toFixed(2));
  const body: Quote = {
    service: "market-data",
    asset,
    price,
    change24h,
    timestamp: new Date().toISOString(),
    requestId: id,
  };
  return { httpStatus: 200, body, requestId: id };
}

export async function getOhlc(asset: string, fail: boolean): Promise<{
  httpStatus: number;
  body: Record<string, unknown>;
  requestId: string;
}> {
  const id = requestId();
  if (fail) {
    return {
      httpStatus: 200,
      requestId: id,
      body: { service: "ohlc", asset, error: "malformed" },
    };
  }
  const live = asset === "ETH" ? await fetchLiveOhlc() : null;
  const candles = live?.candles ?? fallbackCandles();
  const price = live?.price ?? Number(candles.at(-1)?.[4] ?? 4218.32);
  return {
    httpStatus: 200,
    requestId: id,
    body: {
      service: "ohlc",
      asset,
      price,
      candles,
      interval: "hourly",
      timestamp: new Date().toISOString(),
      requestId: id,
    },
  };
}

async function fetchLiveOhlc(): Promise<{ candles: number[][]; price: number } | null> {
  try {
    const res = await fetch(
      "https://api.coingecko.com/api/v3/coins/ethereum/ohlc?vs_currency=usd&days=1",
      { signal: AbortSignal.timeout(4000) },
    );
    if (!res.ok) return null;
    const candles = (await res.json()) as number[][];
    if (!Array.isArray(candles) || candles.length < 2) return null;
    const last = candles.at(-1);
    const price = Number(last?.[4]);
    if (!Number.isFinite(price)) return null;
    return { candles, price };
  } catch {
    return null;
  }
}

function fallbackCandles() {
  const now = Date.now();
  const open = 4210;
  return Array.from({ length: 12 }, (_, i) => {
    const t = now - (11 - i) * 3600_000;
    const drift = i * 1.4;
    return [t, open + drift, open + drift + 8, open + drift - 6, open + drift + 2];
  });
}

export async function getResearchMemo(asset: string, fail: boolean): Promise<{
  httpStatus: number;
  body: Record<string, unknown>;
  requestId: string;
}> {
  const id = requestId();
  if (fail) {
    return {
      httpStatus: 500,
      requestId: id,
      body: { service: "research", asset, status: "timeout" },
    };
  }
  const live = asset === "ETH" ? await fetchLiveEth() : null;
  const price = live?.price ?? 4218.32;
  const body: Quote = {
    service: "research",
    asset,
    price,
    change24h: Number((live?.change24h ?? 2.14).toFixed(2)),
    timestamp: new Date().toISOString(),
    requestId: id,
    summary: `${asset} is trading near ${price.toFixed(2)} USD. This memo is a paid research deliverable held in Arc escrow until the buyer agent verifies the payload.`,
  };
  return { httpStatus: 200, body, requestId: id };
}
