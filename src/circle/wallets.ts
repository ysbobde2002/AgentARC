import { createHash, randomUUID } from "node:crypto";
import { createPublicClient, http, type Address } from "viem";
import { config, paymentMode } from "../config.js";
import { settledUsd } from "../receipts.js";
import { arcChain, ERC20_BALANCE_ABI, fromAtomicUsdc } from "./chain.js";
import { circleErrorMessage, circleReady, getCircleClient, waitForCircleTx } from "./client.js";

export type WalletSnapshot = {
  role: "buyer" | "seller" | "operator";
  label: string;
  walletId: string;
  address: string;
  usdc: string | null;
  source: "circle" | "rpc" | "adapter";
  custody: "user-controlled 2-of-2 MPC";
  product: "Circle Agent Wallet";
  chain: string;
  spendPolicy: {
    nanoMaxUsd: number;
    protectMinUsd: number;
    x402: boolean;
    outbound: boolean;
    note: string;
  };
};

function adapterAddress(role: string): string {
  const digest = createHash("sha256")
    .update(`agentarc:${role}:${config.identity.buyerAgentId}:${config.identity.sellerAgentId}`)
    .digest("hex");
  return `0x${digest.slice(0, 40)}`;
}

function policy(outbound: boolean): WalletSnapshot["spendPolicy"] {
  return {
    nanoMaxUsd: config.policy.nanoMaxUsd,
    protectMinUsd: config.policy.protectMinUsd,
    x402: outbound,
    outbound,
    note: outbound
      ? `Outbound USDC: nanopayments ≤ $${config.policy.nanoMaxUsd}, escrow ≥ $${config.policy.protectMinUsd}`
      : "Receive-only until capture. Seller cannot spend escrowed USDC.",
  };
}

function publicClient() {
  const chain = arcChain(config.arc.network);
  return createPublicClient({
    transport: http(chain.rpcUrl),
  });
}

export async function readUsdcBalance(address: string): Promise<string | null> {
  if (!address || !address.startsWith("0x") || address.length !== 42) return null;
  try {
    const chain = arcChain(config.arc.network);
    const client = publicClient();
    const raw = (await client.readContract({
      address: chain.usdc,
      abi: ERC20_BALANCE_ABI,
      functionName: "balanceOf",
      args: [address as Address],
    })) as bigint;
    return fromAtomicUsdc(raw.toString(), chain.usdcDecimals).toFixed(6);
  } catch {
    return null;
  }
}

export async function transferUsdc(input: {
  fromWalletId: string;
  toAddress: string;
  amountUsd: number;
}): Promise<{ txHash: string; circleTransactionId: string }> {
  const client = await getCircleClient();
  if (!client) throw new Error("Circle Wallets client is not configured");
  const chain = arcChain(config.arc.network);
  const fromAddress =
    input.fromWalletId === config.circle.operatorWalletId
      ? config.circle.operatorWalletAddress
      : input.fromWalletId === config.circle.sellerWalletId
        ? config.circle.sellerWalletAddress
        : config.circle.buyerWalletAddress;
  if (!fromAddress) throw new Error("Source Agent Wallet address is missing");
  const amount = Number(input.amountUsd).toFixed(2);
  try {
    console.log(
      "USDC transfer",
      fromAddress,
      "->",
      input.toAddress,
      "amount",
      amount,
      chain.blockchain,
    );
    const response = await client.createTransaction({
      walletAddress: fromAddress,
      blockchain: chain.blockchain,
      tokenAddress: chain.usdc,
      destinationAddress: input.toAddress,
      amount: [amount],
      fee: { type: "level", config: { feeLevel: "MEDIUM" } },
    });
    const id = response.data?.id;
    if (!id) throw new Error("Circle transfer was not created");
    const done = await waitForCircleTx(client, id);
    return { txHash: done.txHash, circleTransactionId: id };
  } catch (err) {
    console.log("USDC transfer failed:", amount, circleErrorMessage(err));
    throw new Error(`USDC transfer failed: ${circleErrorMessage(err)}`);
  }
}

export async function executeContract(input: {
  walletId: string;
  contractAddress: string;
  abiFunctionSignature: string;
  abiParameters: unknown[];
}): Promise<{ txHash: string; circleTransactionId: string }> {
  const client = await getCircleClient();
  if (!client) throw new Error("Circle Wallets client is not configured");
  const response = await client.createContractExecutionTransaction({
    walletId: input.walletId,
    contractAddress: input.contractAddress,
    abiFunctionSignature: input.abiFunctionSignature,
    abiParameters: input.abiParameters,
    idempotencyKey: randomUUID(),
    fee: { type: "level", config: { feeLevel: "LOW" } },
  });
  const id = response.data?.id;
  if (!id) throw new Error("Circle contract execution was not created");
  const done = await waitForCircleTx(client, id);
  return { txHash: done.txHash, circleTransactionId: id };
}

export async function walletSnapshots(): Promise<WalletSnapshot[]> {
  const chain = arcChain(config.arc.network);
  const roles = [
    {
      role: "buyer" as const,
      label: "Buyer Agent Wallet",
      walletId: config.circle.buyerWalletId,
      address: config.circle.buyerWalletAddress,
      outbound: true,
    },
    {
      role: "seller" as const,
      label: "Seller Agent Wallet",
      walletId: config.circle.sellerWalletId,
      address: config.circle.sellerWalletAddress,
      outbound: false,
    },
    {
      role: "operator" as const,
      label: "Operator Wallet",
      walletId: config.circle.operatorWalletId,
      address: config.circle.operatorWalletAddress,
      outbound: true,
    },
  ];
  const client = circleReady() ? await getCircleClient() : null;
  const out: WalletSnapshot[] = [];
  for (const role of roles) {
    let address = role.address;
    let walletId = role.walletId;
    if (!address && client && walletId) {
      try {
        const w = await client.getWallet({ id: walletId });
        address = w.data?.wallet?.address || "";
      } catch {
        address = "";
      }
    }
    let usdc: string | null = null;
    let source: WalletSnapshot["source"] = "adapter";
    if (client && walletId) {
      try {
        const bal = await client.getWalletTokenBalance({ id: walletId });
        const usdcRow = bal.data?.tokenBalances?.find(
          (t) =>
            t.token?.symbol === "USDC" ||
            t.token?.tokenAddress?.toLowerCase() === chain.usdc.toLowerCase(),
        );
        if (usdcRow?.amount != null) {
          usdc = usdcRow.amount;
          source = "circle";
        }
      } catch {
        /* fall through to RPC */
      }
    }
    if (!address) address = adapterAddress(role.role);
    if (!walletId) walletId = `adapter:${role.role}`;
    if (usdc == null && address && source !== "circle") {
      usdc = await readUsdcBalance(address);
      if (usdc != null) source = "rpc";
    }
    const spent = settledUsd();
    if (paymentMode() !== "circle" && usdc != null && spent > 0) {
      const raw = Number(usdc);
      if (Number.isFinite(raw)) {
        usdc = (role.role === "seller" ? raw + spent : Math.max(0, raw - spent)).toFixed(6);
      }
    }
    out.push({
      role: role.role,
      label: role.label,
      walletId,
      address,
      usdc,
      source,
      custody: "user-controlled 2-of-2 MPC",
      product: "Circle Agent Wallet",
      chain: chain.name,
      spendPolicy: policy(role.outbound),
    });
  }
  return out;
}

export async function agentWallets() {
  const all = await walletSnapshots();
  return {
    product: "Circle Agent Wallet",
    custody: "User retains custody. Key shares are never exposed to the agent. Circle cannot move funds unilaterally.",
    live: circleReady(),
    buyer: all.find((w) => w.role === "buyer")!,
    seller: all.find((w) => w.role === "seller")!,
  };
}
