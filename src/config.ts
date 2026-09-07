import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { arcChain, type ArcNetwork } from "./circle/chain.js";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");

function loadEnvFile() {
  for (const name of [".env.local", ".env"]) {
    const path = join(ROOT, name);
    if (!existsSync(path)) continue;
    for (const line of readFileSync(path, "utf8").split("\n")) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith("#")) continue;
      const eq = trimmed.indexOf("=");
      if (eq < 1) continue;
      const key = trimmed.slice(0, eq).trim();
      const value = trimmed.slice(eq + 1).trim();
      if (!key || !value) continue;
      if (!(key in process.env)) process.env[key] = value;
    }
  }
}

loadEnvFile();

function num(name: string, fallback: number) {
  const raw = process.env[name];
  if (!raw) return fallback;
  const n = Number(raw);
  return Number.isFinite(n) ? n : fallback;
}

export const ROOT_DIR = ROOT;

const network = (process.env.ARC_NETWORK || "testnet") as ArcNetwork;
const chain = arcChain(network);

export const config = {
  port: Number(process.env.PORT || 5180),
  arc: {
    network,
    name: chain.name,
    rpcUrl: chain.rpcUrl,
    chainId: chain.chainId,
    caip2: chain.caip2,
    blockchain: chain.blockchain,
    usdc: chain.usdc,
    eurc: chain.eurc,
    explorer: chain.explorer,
    escrow: process.env.AUTH_CAPTURE_ESCROW_ADDRESS || chain.authCaptureEscrow,
    collector: process.env.ERC3009_COLLECTOR_ADDRESS || chain.erc3009Collector,
    gatewayWallet: chain.gatewayWallet,
    gatewayApi: chain.gatewayApi,
    gatewayDomain: chain.gatewayDomain,
  },
  circle: {
    apiKey: process.env.CIRCLE_API_KEY || "",
    entitySecret: process.env.CIRCLE_ENTITY_SECRET || "",
    baseUrl: process.env.CIRCLE_BASE_URL || "https://api.circle.com",
    walletSetId: process.env.CIRCLE_WALLET_SET_ID || "",
    buyerWalletId: process.env.BUYER_WALLET_ID || "",
    sellerWalletId: process.env.SELLER_WALLET_ID || "",
    operatorWalletId: process.env.OPERATOR_WALLET_ID || "",
    buyerWalletAddress: process.env.BUYER_WALLET_ADDRESS || "",
    sellerWalletAddress: process.env.SELLER_WALLET_ADDRESS || "",
    operatorWalletAddress: process.env.OPERATOR_WALLET_ADDRESS || "",
  },
  identity: {
    identityRegistry:
      process.env.ERC8004_IDENTITY_REGISTRY || "0x8004A818BFB912233c491871b3d84c89A494BD9e",
    reputationRegistry:
      process.env.ERC8004_REPUTATION_REGISTRY || "0x8004B663056A597Dffe9eCcC1965A193B7388713",
    buyerAgentId: process.env.BUYER_AGENT_ID || "9638",
    sellerAgentId: process.env.SELLER_AGENT_ID || "6832",
    buyerName: process.env.BUYER_AGENT_NAME || "Buyer Agent",
    sellerName: process.env.SELLER_AGENT_NAME || "Market Data Agent",
    chainId: Number(process.env.ERC8004_CHAIN_ID || 11155111),
    scanApi: process.env.SCAN8004_API_BASE || "https://8004scan.io/api/v1/public",
    scanWeb: process.env.SCAN8004_WEB_BASE || "https://testnet.8004scan.io",
  },
  seller: {
    port: Number(process.env.SELLER_PORT || 5181),
    origin: process.env.SELLER_ORIGIN || `http://127.0.0.1:${Number(process.env.SELLER_PORT || 5181)}`,
  },
  policy: {
    nanoMaxUsd: num("NANO_MAX_USD", 1),
    protectMinUsd: num("PROTECT_MIN_USD", 100),
  },
  marketDataSource: process.env.MARKET_DATA_SOURCE || "coingecko",
  openai: {
    apiKey: process.env.OPENAI_API_KEY || "",
    model: process.env.OPENAI_MODEL || "gpt-4o-mini",
  },
};

export function paymentMode(): "circle" | "adapter" {
  return config.circle.apiKey && config.circle.entitySecret ? "circle" : "adapter";
}

export function explorerTx(hash: string) {
  if (!hash || hash === "pending") return config.arc.explorer;
  return `${config.arc.explorer}/tx/${hash}`;
}

export function explorerAddress(address: string) {
  return `${config.arc.explorer}/address/${address}`;
}

export function originUrl() {
  return process.env.PUBLIC_ORIGIN || `http://127.0.0.1:${config.port}`;
}
