/** Arc + Circle Gateway constants. Mainnet fields are env-overridable until Circle publishes them. */

export type ArcNetwork = "testnet" | "mainnet";

export type ArcChain = {
  network: ArcNetwork;
  name: string;
  chainId: number;
  caip2: string;
  blockchain: string;
  rpcUrl: string;
  explorer: string;
  usdc: `0x${string}`;
  usdcDecimals: number;
  eurc: `0x${string}`;
  gatewayWallet: `0x${string}`;
  gatewayMinter: `0x${string}`;
  gatewayDomain: number;
  gatewayApi: string;
  permit2: `0x${string}`;
  authCaptureEscrow: `0x${string}`;
  erc3009Collector: `0x${string}`;
};

const TESTNET: ArcChain = {
  network: "testnet",
  name: "Arc Testnet",
  chainId: 5042002,
  caip2: "eip155:5042002",
  blockchain: "ARC-TESTNET",
  rpcUrl: "https://rpc.testnet.arc.network",
  explorer: "https://testnet.arcscan.app",
  usdc: "0x3600000000000000000000000000000000000000",
  usdcDecimals: 6,
  eurc: "0x89B50855Aa3bE2F677cD6303Cec089B5F319D72a",
  gatewayWallet: "0x0077777d7EBA4688BDeF3E311b846F25870A19B9",
  gatewayMinter: "0x0022222ABE238Cc2C7Bb1f21003F0a260052475B",
  gatewayDomain: 26,
  gatewayApi: "https://gateway-api-testnet.circle.com",
  permit2: "0x000000000022D473030F116dDEE9F6B43aC78BA3",
  authCaptureEscrow: "0xa5b4fa1890619cf03b8d6b11e0c680345b1881d8",
  erc3009Collector: "0x01e39d4a0b8ffeac8ae1618dbf316d15a8ee867c",
};

const MAINNET: ArcChain = {
  network: "mainnet",
  name: "Arc Mainnet",
  chainId: Number(process.env.ARC_MAINNET_CHAIN_ID || 5042001),
  caip2: `eip155:${process.env.ARC_MAINNET_CHAIN_ID || 5042001}`,
  blockchain: process.env.ARC_MAINNET_BLOCKCHAIN || "ARC",
  rpcUrl: process.env.ARC_MAINNET_RPC_URL || "https://rpc.arc.network",
  explorer: process.env.ARC_MAINNET_EXPLORER_URL || "https://arcscan.app",
  usdc: (process.env.ARC_MAINNET_USDC ||
    "0x3600000000000000000000000000000000000000") as `0x${string}`,
  usdcDecimals: 6,
  eurc: (process.env.ARC_MAINNET_EURC ||
    "0x0000000000000000000000000000000000000000") as `0x${string}`,
  gatewayWallet: (process.env.ARC_MAINNET_GATEWAY_WALLET ||
    "0x0077777d7EBA4688BDeF3E311b846F25870A19B9") as `0x${string}`,
  gatewayMinter: (process.env.ARC_MAINNET_GATEWAY_MINTER ||
    "0x0022222ABE238Cc2C7Bb1f21003F0a260052475B") as `0x${string}`,
  gatewayDomain: Number(process.env.ARC_MAINNET_GATEWAY_DOMAIN || 26),
  gatewayApi: process.env.ARC_MAINNET_GATEWAY_API || "https://gateway-api.circle.com",
  permit2: "0x000000000022D473030F116dDEE9F6B43aC78BA3",
  authCaptureEscrow: (process.env.AUTH_CAPTURE_ESCROW_ADDRESS ||
    "") as `0x${string}`,
  erc3009Collector: (process.env.ERC3009_COLLECTOR_ADDRESS || "") as `0x${string}`,
};

export function arcChain(network: ArcNetwork): ArcChain {
  const base = network === "mainnet" ? MAINNET : TESTNET;
  return {
    ...base,
    rpcUrl: process.env.ARC_RPC_URL || base.rpcUrl,
    explorer: process.env.ARC_EXPLORER_URL || base.explorer,
    usdc: (process.env.USDC_CONTRACT_ADDRESS || base.usdc) as `0x${string}`,
    authCaptureEscrow: (process.env.AUTH_CAPTURE_ESCROW_ADDRESS ||
      base.authCaptureEscrow) as `0x${string}`,
    erc3009Collector: (process.env.ERC3009_COLLECTOR_ADDRESS ||
      base.erc3009Collector) as `0x${string}`,
    gatewayApi: process.env.GATEWAY_API_URL || base.gatewayApi,
  };
}

export function toAtomicUsdc(amountUsd: number, decimals = 6): string {
  const scaled = Math.round(amountUsd * 10 ** decimals);
  return String(scaled);
}

export function fromAtomicUsdc(atomic: string | number, decimals = 6): number {
  return Number(atomic) / 10 ** decimals;
}

export const ERC20_BALANCE_ABI = [
  {
    type: "function",
    name: "balanceOf",
    stateMutability: "view",
    inputs: [{ name: "account", type: "address" }],
    outputs: [{ name: "", type: "uint256" }],
  },
  {
    type: "function",
    name: "decimals",
    stateMutability: "view",
    inputs: [],
    outputs: [{ name: "", type: "uint8" }],
  },
  {
    type: "function",
    name: "transfer",
    stateMutability: "nonpayable",
    inputs: [
      { name: "to", type: "address" },
      { name: "amount", type: "uint256" },
    ],
    outputs: [{ name: "", type: "bool" }],
  },
] as const;
