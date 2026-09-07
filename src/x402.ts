import { createHash, randomBytes } from "node:crypto";
import { arcChain, toAtomicUsdc } from "./circle/chain.js";
import { config } from "./config.js";

export type PaymentRequirements = {
  scheme: string;
  network: string;
  asset: string;
  amount: string;
  payTo: string;
  maxTimeoutSeconds: number;
  extra: Record<string, unknown>;
};

export type PaymentRequiredBody = {
  x402Version: number;
  resource: { url: string; description: string; mimeType: string };
  accepts: PaymentRequirements[];
};

export type PaymentPayload = {
  x402Version: number;
  accepted: PaymentRequirements;
  resource?: { url: string; description: string; mimeType: string };
  payload: Record<string, unknown>;
};

export function nanoRequirements(amountUsd: number, resourceUrl: string): PaymentRequiredBody {
  const chain = arcChain(config.arc.network);
  return {
    x402Version: 2,
    resource: {
      url: resourceUrl,
      description: resourceUrl.includes("ohlc") ? "AgentARC ETH OHLC" : "AgentARC ETH chart",
      mimeType: "application/json",
    },
    accepts: [
      {
        scheme: "exact",
        network: chain.caip2,
        asset: chain.usdc,
        amount: toAtomicUsdc(amountUsd, chain.usdcDecimals),
        payTo: config.circle.sellerWalletAddress || "0x0000000000000000000000000000000000000001",
        maxTimeoutSeconds: 604900,
        extra: {
          name: "GatewayWalletBatched",
          version: "1",
          verifyingContract: chain.gatewayWallet,
          minValiditySeconds: 604800,
        },
      },
    ],
  };
}

export function encodePaymentRequired(body: PaymentRequiredBody): string {
  return Buffer.from(JSON.stringify(body)).toString("base64");
}

export function decodePaymentRequired(header: string): PaymentRequiredBody {
  return JSON.parse(Buffer.from(header, "base64").toString("utf8")) as PaymentRequiredBody;
}

export function encodePaymentSignature(payload: PaymentPayload): string {
  return Buffer.from(JSON.stringify(payload)).toString("base64");
}

export function decodePaymentSignature(header: string): PaymentPayload {
  return JSON.parse(Buffer.from(header, "base64").toString("utf8")) as PaymentPayload;
}

export function adapterPaymentPayload(
  required: PaymentRequiredBody,
  amountUsd: number,
): PaymentPayload {
  const accepted = required.accepts[0];
  if (!accepted) throw new Error("No x402 payment options advertised");
  return {
    x402Version: required.x402Version,
    accepted,
    resource: required.resource,
    payload: {
      mode: "adapter",
      authorization: {
        from: config.circle.buyerWalletAddress || "adapter-buyer",
        to: accepted.payTo,
        value: accepted.amount,
        nonce: `0x${createHash("sha256").update(`${Date.now()}:${randomBytes(8).toString("hex")}`).digest("hex")}`,
        validAfter: "0",
        validBefore: String(Math.floor(Date.now() / 1000) + 604900),
      },
      amountUsd,
    },
  };
}

export function isAdapterPayload(payload: PaymentPayload): boolean {
  return payload.payload?.mode === "adapter";
}
