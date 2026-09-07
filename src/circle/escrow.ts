import { createHash, randomUUID } from "node:crypto";
import { config, explorerTx, paymentMode } from "../config.js";
import type { PaymentEvidence } from "../types.js";
import { circleReady } from "./client.js";
import { transferUsdc } from "./wallets.js";

const jobs = new Map<
  string,
  { buyer: string; seller: string; amountUsd: number; status: "authorized" | "captured" | "voided" }
>();

function demoHash(label: string) {
  return (`0x` +
    createHash("sha256")
      .update(`${label}:${Date.now()}:${randomUUID()}`)
      .digest("hex")) as `0x${string}`;
}

/**
 * AuthCapture rail.
 *
 * Live path (Circle keys):
 *  1. Buyer Agent Wallet transfers USDC to the operator (authorize / hold).
 *  2. Capture: operator transfers USDC to the seller. Void: operator returns USDC to the buyer.
 *  Contract `executeContract` against AgentJobEscrow is skipped on Arc testnet
 *  (Circle returns "API parameter invalid" / estimate revert).
 *
 * Adapter path: labeled hashes so the UI is complete without keys.
 */
export async function authorizeEscrow(amountUsd: number): Promise<PaymentEvidence> {
  const jobId = randomUUID();
  const mode = paymentMode();

  if (mode === "circle" && circleReady() && config.circle.buyerWalletId && config.circle.operatorWalletAddress) {
    const transfer = await transferUsdc({
      fromWalletId: config.circle.buyerWalletId,
      toAddress: config.circle.operatorWalletAddress,
      amountUsd,
    });

    jobs.set(jobId, {
      buyer: config.circle.buyerWalletAddress,
      seller: config.circle.sellerWalletAddress,
      amountUsd,
      status: "authorized",
    });

    return {
      mode: "circle",
      rail: "PROTECTED",
      scheme: "auth-capture",
      amountUsd,
      jobId,
      authorizeTxHash: transfer.txHash,
      circleTransactionId: transfer.circleTransactionId,
      explorerUrl: explorerTx(transfer.txHash),
      note: "USDC authorized into operator escrow on Arc · not captured",
    };
  }

  const authorizeTxHash = demoHash("escrow-authorize");
  jobs.set(jobId, {
    buyer: config.identity.buyerAgentId,
    seller: config.identity.sellerAgentId,
    amountUsd,
    status: "authorized",
  });
  return {
    mode,
    rail: "PROTECTED",
    scheme: "auth-capture",
    amountUsd,
    jobId,
    authorizeTxHash,
    explorerUrl: explorerTx(authorizeTxHash),
    note: mode === "circle"
      ? "Circle keys present but buyer/operator wallets are incomplete"
      : "Adapter AuthCapture — paste Circle keys to lock live USDC",
  };
}

export async function captureEscrow(pending: PaymentEvidence): Promise<PaymentEvidence> {
  const job = pending.jobId ? jobs.get(pending.jobId) : undefined;
  if (job && job.status !== "authorized") {
    throw new Error(`Escrow job is already ${job.status}`);
  }
  if (pending.mode === "circle" && circleReady() && config.circle.operatorWalletId && config.circle.sellerWalletAddress && job) {
    const transfer = await transferUsdc({
      fromWalletId: config.circle.operatorWalletId,
      toAddress: config.circle.sellerWalletAddress,
      amountUsd: job.amountUsd,
    });
    job.status = "captured";
    return {
      ...pending,
      captureTxHash: transfer.txHash,
      settleTxHash: transfer.txHash,
      circleTransactionId: transfer.circleTransactionId,
      explorerUrl: explorerTx(transfer.txHash),
      note: "Captured · operator released USDC to seller on Arc",
    };
  }

  const captureTxHash = demoHash("escrow-capture");
  if (job) job.status = "captured";
  return {
    ...pending,
    captureTxHash,
    settleTxHash: captureTxHash,
    explorerUrl: explorerTx(captureTxHash),
  };
}

export async function voidEscrow(pending: PaymentEvidence): Promise<PaymentEvidence> {
  const job = pending.jobId ? jobs.get(pending.jobId) : undefined;
  if (job && job.status !== "authorized") {
    throw new Error(`Escrow job is already ${job.status}`);
  }
  if (pending.mode === "circle" && circleReady() && config.circle.operatorWalletId && config.circle.buyerWalletAddress && job) {
    const transfer = await transferUsdc({
      fromWalletId: config.circle.operatorWalletId,
      toAddress: config.circle.buyerWalletAddress,
      amountUsd: job.amountUsd,
    });
    job.status = "voided";
    return {
      ...pending,
      voidTxHash: transfer.txHash,
      settleTxHash: transfer.txHash,
      circleTransactionId: transfer.circleTransactionId,
      explorerUrl: explorerTx(transfer.txHash),
      note: "Voided · operator returned USDC to buyer on Arc",
    };
  }

  const voidTxHash = demoHash("escrow-void");
  if (job) job.status = "voided";
  return {
    ...pending,
    voidTxHash,
    settleTxHash: voidTxHash,
    explorerUrl: explorerTx(voidTxHash),
  };
}

export function getEscrowJob(jobId: string) {
  return jobs.get(jobId) ?? null;
}
