import { config } from "../config.js";

type CircleClient = {
  createTransaction: (input: Record<string, unknown>) => Promise<{ data?: { id?: string; txHash?: string; state?: string } }>;
  createContractExecutionTransaction: (input: Record<string, unknown>) => Promise<{ data?: { id?: string } }>;
  getTransaction: (input: { id: string }) => Promise<{
    data?: {
      transaction?: {
        state?: string;
        txHash?: string;
        id?: string;
        errorReason?: string;
        errorDetails?: string;
      };
    };
  }>;
  signTypedData: (input: Record<string, unknown>) => Promise<{ data?: { signature?: string } }>;
  getWalletTokenBalance: (input: { id: string }) => Promise<{
    data?: { tokenBalances?: Array<{ token?: { symbol?: string; tokenAddress?: string }; amount?: string }> };
  }>;
  getWallet: (input: { id: string }) => Promise<{ data?: { wallet?: { address?: string; blockchain?: string } } }>;
};

let cached: CircleClient | null | undefined;

export function circleErrorMessage(err: unknown): string {
  if (!err || typeof err !== "object") return String(err);
  const rec = err as {
    message?: string;
    response?: { data?: { message?: string; code?: number | string; errors?: Array<{ message?: string; invalidValue?: string; location?: string }> } };
  };
  const data = rec.response?.data;
  const extra = (data?.errors || [])
    .map((e) => [e.location, e.message, e.invalidValue].filter(Boolean).join(" "))
    .filter(Boolean)
    .join("; ");
  const api = data?.message;
  if (api && extra) return `${api}: ${extra}`;
  if (api) return data?.code ? `${api} (${data.code})` : api;
  return rec.message || "Circle request failed";
}

export function circleReady(): boolean {
  return Boolean(config.circle.apiKey && config.circle.entitySecret);
}

export async function getCircleClient(): Promise<CircleClient | null> {
  if (cached !== undefined) return cached;
  if (!circleReady()) {
    cached = null;
    return null;
  }
  try {
    const mod = await import("@circle-fin/developer-controlled-wallets");
    cached = mod.initiateDeveloperControlledWalletsClient({
      apiKey: config.circle.apiKey,
      entitySecret: config.circle.entitySecret,
      baseUrl: config.circle.baseUrl,
    }) as unknown as CircleClient;
    return cached;
  } catch (err) {
    console.warn("Circle Wallets SDK failed to initialize:", err);
    cached = null;
    return null;
  }
}

export async function waitForCircleTx(
  client: CircleClient,
  transactionId: string,
): Promise<{ txHash: string; state: string }> {
  const terminal = new Set(["COMPLETE", "CONFIRMED", "FAILED", "DENIED", "CANCELLED"]);
  for (let i = 0; i < 40; i++) {
    const response = await client.getTransaction({ id: transactionId });
    const tx = response.data?.transaction;
    const state = tx?.state ?? "";
    if (terminal.has(state)) {
      if (state !== "COMPLETE" && state !== "CONFIRMED") {
        const why = [tx?.errorReason, tx?.errorDetails].filter(Boolean).join(" · ");
        throw new Error(`Circle transaction ended in state ${state}${why ? `: ${why}` : ""}`);
      }
      return { txHash: tx?.txHash || transactionId, state };
    }
    await new Promise((r) => setTimeout(r, 2000));
  }
  throw new Error(`Circle transaction ${transactionId} did not confirm in time`);
}
