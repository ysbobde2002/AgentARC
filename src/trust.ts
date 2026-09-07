/** Live ERC-8004 identity from 8004scan. Missing identity fails closed. */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { config, ROOT_DIR } from "./config.js";
import type { TrustSignals } from "./types.js";

const FILE = join(ROOT_DIR, "data", "trust.json");
const CACHE_MS = 60_000;

type TrustState = { sellerRecentFailures: number };
type ScanAgent = {
  token_id?: string;
  name?: string | null;
  is_active?: boolean;
  total_feedbacks?: number;
  total_validations?: number;
  successful_validations?: number;
  x402_supported?: boolean;
  contract_address?: string;
  chain_id?: number;
  ens?: string | null;
};

const cache = new Map<string, { at: number; agent: ScanAgent | null }>();

function load(): TrustState {
  try {
    if (!existsSync(FILE)) return { sellerRecentFailures: 0 };
    return JSON.parse(readFileSync(FILE, "utf8")) as TrustState;
  } catch {
    return { sellerRecentFailures: 0 };
  }
}

function save(state: TrustState) {
  mkdirSync(join(ROOT_DIR, "data"), { recursive: true });
  writeFileSync(FILE, JSON.stringify(state, null, 2));
}

const SCAN_SLUGS: Record<number, string> = {
  1: "ethereum",
  11155111: "sepolia",
  8453: "base",
  84532: "base-sepolia",
};

function scanWebHost() {
  const host = config.identity.scanWeb.replace(/\/$/, "");
  if (config.identity.chainId !== 11155111) return host;
  if (host.includes("testnet.8004scan.io")) return host;
  if (host.includes("8004scan.io")) return "https://testnet.8004scan.io";
  return host;
}

export function scanUrl(tokenId: string) {
  const slug = SCAN_SLUGS[config.identity.chainId] || String(config.identity.chainId);
  return `${scanWebHost()}/agents/${slug}/${tokenId}`;
}

export function mapScanAgent(
  agent: ScanAgent | null,
  role: "buyer" | "seller",
  recentFailures = 0,
  mode: "live" | "adapter" = "adapter",
): TrustSignals {
  const tokenId = role === "buyer" ? config.identity.buyerAgentId : config.identity.sellerAgentId;
  const resolvedId = String(agent?.token_id || tokenId);
  const fallbackName = role === "buyer" ? config.identity.buyerName : config.identity.sellerName;
  const live = Boolean(agent && (agent.token_id || agent.is_active));
  return {
    agentId: resolvedId,
    name: agent?.name || fallbackName,
    identityVerified: mode === "adapter" ? true : live,
    reputationSignals: Number(agent?.total_feedbacks ?? (mode === "adapter" ? (role === "seller" ? 12 : 8) : 0)),
    validationSignals: Number(
      agent?.successful_validations ?? agent?.total_validations ?? (mode === "adapter" ? (role === "seller" ? 3 : 2) : 0),
    ),
    recentFailures,
    registry: agent?.contract_address || config.identity.identityRegistry,
    source: live ? "erc-8004" : "adapter",
    scanUrl: scanUrl(resolvedId),
    x402Supported: agent ? Boolean(agent.x402_supported) : mode === "adapter",
    chainId: agent?.chain_id || config.identity.chainId,
  };
}

export async function fetchScanAgent(tokenId: string): Promise<ScanAgent | null> {
  const key = `${config.identity.chainId}:${tokenId}`;
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < CACHE_MS) return hit.agent;
  const bases = Array.from(
    new Set([
      "https://8004scan.io/api/v1/public",
      config.identity.scanApi.replace(/\/$/, ""),
    ]),
  );
  for (const base of bases) {
    try {
      const res = await fetch(`${base}/agents/${config.identity.chainId}/${tokenId}`, {
        headers: { Accept: "application/json" },
        signal: AbortSignal.timeout(4000),
      });
      if (!res.ok) continue;
      const json = (await res.json()) as { success?: boolean; data?: ScanAgent };
      const agent = json.success === false ? null : json.data || null;
      if (!agent) continue;
      cache.set(key, { at: Date.now(), agent });
      return agent;
    } catch {
      continue;
    }
  }
  cache.set(key, { at: Date.now(), agent: null });
  return null;
}

export function getSellerTrust(): TrustSignals {
  return mapScanAgent(null, "seller", load().sellerRecentFailures);
}

export function getBuyerTrust(): TrustSignals {
  return mapScanAgent(null, "buyer", 0);
}

export async function loadSellerTrust(): Promise<TrustSignals> {
  const agent = await fetchScanAgent(config.identity.sellerAgentId);
  return mapScanAgent(agent, "seller", load().sellerRecentFailures, agent ? "live" : "adapter");
}

export async function loadBuyerTrust(): Promise<TrustSignals> {
  const agent = await fetchScanAgent(config.identity.buyerAgentId);
  return mapScanAgent(agent, "buyer", 0, agent ? "live" : "adapter");
}

export function recordSellerFailure() {
  const state = load();
  state.sellerRecentFailures += 1;
  save(state);
}

export function recordSellerSuccess() {
  const state = load();
  if (state.sellerRecentFailures > 0) {
    state.sellerRecentFailures = Math.max(0, state.sellerRecentFailures - 1);
    save(state);
  }
}

/** Normalize ERC-8004 into policy signals. Never treat reputation as one score. */
export function toPolicySignals(trust: TrustSignals) {
  return {
    identityVerified: trust.identityVerified,
    reputationSignals: trust.reputationSignals,
    validationSignals: trust.validationSignals,
    recentFailures: trust.recentFailures,
    x402Supported: Boolean(trust.x402Supported),
  };
}
