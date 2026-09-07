import { createHash, randomBytes, randomUUID } from "node:crypto";
import { config, explorerTx } from "../config.js";
import type { PaymentEvidence } from "../types.js";
import {
  adapterPaymentPayload,
  decodePaymentRequired,
  decodePaymentSignature,
  encodePaymentRequired,
  encodePaymentSignature,
  isAdapterPayload,
  nanoRequirements,
  type PaymentPayload,
  type PaymentRequiredBody,
} from "../x402.js";
import { arcChain, toAtomicUsdc } from "./chain.js";
import { circleReady, getCircleClient } from "./client.js";
import { executeContract, transferUsdc } from "./wallets.js";

export async function advertiseNanopayment(amountUsd: number, resourceUrl: string) {
  const body = nanoRequirements(amountUsd, resourceUrl);
  return {
    status: 402,
    headers: { "PAYMENT-REQUIRED": encodePaymentRequired(body) },
    body,
  };
}

export async function createNanopaymentAuthorization(
  requiredHeader: string,
  amountUsd: number,
): Promise<{ header: string; payload: PaymentPayload; evidence: PaymentEvidence }> {
  const required = decodePaymentRequired(requiredHeader);
  const accepted =
    required.accepts.find(
      (o) => o.extra?.name === "GatewayWalletBatched" && o.network === arcChain(config.arc.network).caip2,
    ) ?? required.accepts[0];
  if (!accepted) throw new Error("Seller did not advertise a Gateway nanopayment option");

  if (!circleReady() || !config.circle.buyerWalletId) {
    const payload = adapterPaymentPayload(required, amountUsd);
    const hash = demoHash("nano-adapter");
    return {
      header: encodePaymentSignature(payload),
      payload,
      evidence: {
        mode: "adapter",
        rail: "DIRECT",
        scheme: "nanopayments",
        amountUsd,
        settleTxHash: hash,
        explorerUrl: explorerTx(hash),
        x402: {
          network: accepted.network,
          scheme: accepted.scheme,
          payTo: accepted.payTo,
          amountAtomic: accepted.amount,
        },
        gateway: { domain: arcChain(config.arc.network).gatewayDomain, batched: true },
        note: "Adapter nanopayment — paste CIRCLE_API_KEY to sign EIP-3009 via Agent Wallets",
      },
    };
  }

  const payload = await signGatewayAuthorization(required, accepted, amountUsd);
  const hash = demoHash("nano-signed");
  return {
    header: encodePaymentSignature(payload),
    payload,
    evidence: {
      mode: "circle",
      rail: "DIRECT",
      scheme: "nanopayments",
      amountUsd,
      settleTxHash: hash,
      explorerUrl: explorerTx(hash),
      x402: {
        network: accepted.network,
        scheme: accepted.scheme,
        payTo: accepted.payTo,
        amountAtomic: accepted.amount,
      },
      gateway: { domain: arcChain(config.arc.network).gatewayDomain, batched: true },
      note: "EIP-3009 signed by Circle Agent Wallet · Gateway will batch-settle on Arc",
    },
  };
}

export async function settleNanopayment(
  signatureHeader: string,
  amountUsd: number,
): Promise<{ ok: boolean; evidence: Partial<PaymentEvidence>; payer?: string }> {
  const payload = decodePaymentSignature(signatureHeader);
  if (isAdapterPayload(payload)) {
    return {
      ok: true,
      payer: String(payload.payload.authorization && (payload.payload.authorization as { from?: string }).from || "adapter-buyer"),
      evidence: { mode: "adapter", note: "Adapter x402 signature accepted (no Circle keys)" },
    };
  }

  const chain = arcChain(config.arc.network);
  let json: {
    success?: boolean;
    transaction?: string;
    errorReason?: string;
    payer?: string;
  } = { success: false, errorReason: "Gateway settle failed" };
  try {
    const response = await fetch(`${chain.gatewayApi}/v1/x402/settle`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        paymentPayload: payload,
        paymentRequirements: payload.accepted,
      }),
      signal: AbortSignal.timeout(8000),
    });
    json = (await response.json()) as typeof json;
  } catch (err) {
    json = {
      success: false,
      errorReason: err instanceof Error ? err.message : "Gateway unreachable",
    };
  }
  if (!json.success) {
    const from =
      payload.payload?.authorization &&
      typeof payload.payload.authorization === "object"
        ? String((payload.payload.authorization as { from?: string }).from || "")
        : "";
    if (
      circleReady() &&
      config.circle.buyerWalletId &&
      config.circle.sellerWalletAddress &&
      from.toLowerCase() === config.circle.buyerWalletAddress.toLowerCase()
    ) {
      try {
        const sent = await transferUsdc({
          fromWalletId: config.circle.buyerWalletId,
          toAddress: config.circle.sellerWalletAddress,
          amountUsd,
        });
        return {
          ok: true,
          payer: from,
          evidence: {
            mode: "circle",
            settleTxHash: sent.txHash,
            circleTransactionId: sent.circleTransactionId,
            explorerUrl: explorerTx(sent.txHash),
            note: `Gateway batch unavailable (${json.errorReason || "settle failed"}). Settled ${amountUsd} USDC on Arc from the buyer Agent Wallet.`,
          },
        };
      } catch (err) {
        const msg = err instanceof Error ? err.message : "USDC transfer failed";
        console.error("nanopayment Arc transfer fallback:", msg);
        return { ok: false, evidence: { note: `${json.errorReason || "Gateway settle failed"}; Arc transfer: ${msg}` } };
      }
    }
    return { ok: false, evidence: { note: json.errorReason || "Gateway settle failed" } };
  }
  return {
    ok: true,
    payer: json.payer,
    evidence: {
      mode: "circle",
      circleTransactionId: json.transaction,
      settleTxHash: json.transaction,
      explorerUrl: explorerTx(json.transaction || "pending"),
      note: `Gateway batched nanopayment ${amountUsd} USDC`,
    },
  };
}

async function signGatewayAuthorization(
  required: PaymentRequiredBody,
  accepted: PaymentRequiredBody["accepts"][0],
  amountUsd: number,
): Promise<PaymentPayload> {
  const client = await getCircleClient();
  if (!client) throw new Error("Circle client missing");
  const chain = arcChain(config.arc.network);
  const from = config.circle.buyerWalletAddress;
  if (!from) throw new Error("BUYER_WALLET_ADDRESS is required to sign nanopayments");

  const nonce = (`0x` + randomBytes(32).toString("hex")) as `0x${string}`;
  const validAfter = 0;
  const validBefore = Math.floor(Date.now() / 1000) + 604900;
  const value = accepted.amount || toAtomicUsdc(amountUsd, chain.usdcDecimals);

  const typedData = {
    types: {
      EIP712Domain: [
        { name: "name", type: "string" },
        { name: "version", type: "string" },
        { name: "chainId", type: "uint256" },
        { name: "verifyingContract", type: "address" },
      ],
      TransferWithAuthorization: [
        { name: "from", type: "address" },
        { name: "to", type: "address" },
        { name: "value", type: "uint256" },
        { name: "validAfter", type: "uint256" },
        { name: "validBefore", type: "uint256" },
        { name: "nonce", type: "bytes32" },
      ],
    },
    domain: {
      name: "GatewayWallet",
      version: "1",
      chainId: chain.chainId,
      verifyingContract: chain.gatewayWallet,
    },
    primaryType: "TransferWithAuthorization",
    message: {
      from,
      to: accepted.payTo,
      value,
      validAfter: String(validAfter),
      validBefore: String(validBefore),
      nonce,
    },
  };

  const signed = await client.signTypedData({
    walletId: config.circle.buyerWalletId,
    data: JSON.stringify(typedData),
    memo: "AgentARC x402 nanopayment",
  });
  const signature = signed.data?.signature;
  if (!signature) throw new Error("Circle Wallets returned no EIP-712 signature");

  return {
    x402Version: required.x402Version,
    accepted,
    resource: required.resource,
    payload: {
      signature: signature.startsWith("0x") ? signature : `0x${signature}`,
      authorization: typedData.message,
    },
  };
}

/** Optional: deposit USDC into Gateway so nanopayments can be gasless. */
export async function ensureGatewayDeposit(amountUsd: number): Promise<string | null> {
  if (!circleReady() || !config.circle.buyerWalletId) return null;
  const chain = arcChain(config.arc.network);
  const atomic = toAtomicUsdc(amountUsd, chain.usdcDecimals);
  await executeContract({
    walletId: config.circle.buyerWalletId,
    contractAddress: chain.usdc,
    abiFunctionSignature: "approve(address,uint256)",
    abiParameters: [chain.gatewayWallet, atomic],
  });
  const deposit = await executeContract({
    walletId: config.circle.buyerWalletId,
    contractAddress: chain.gatewayWallet,
    abiFunctionSignature: "deposit(address,uint256)",
    abiParameters: [chain.usdc, atomic],
  });
  return deposit.txHash;
}

function demoHash(label: string) {
  return (`0x` +
    createHash("sha256")
      .update(`${label}:${Date.now()}:${randomUUID()}`)
      .digest("hex")) as `0x${string}`;
}
