import { explorerTx, paymentMode } from "./config.js";
import type { Outcome, PaymentEvidence, Receipt, Rail, VerificationResult } from "./types.js";

const receipts = new Map<string, Receipt>();

export function buildReceipt(input: {
  id: string;
  buyerAgent: string;
  sellerAgent: string;
  service: string;
  amountUsd: number;
  rail: Rail;
  payment: PaymentEvidence;
  verification: VerificationResult | null;
  outcome: Outcome;
}): Receipt {
  const paymentTxHash =
    input.payment.captureTxHash ||
    input.payment.voidTxHash ||
    input.payment.settleTxHash ||
    input.payment.authorizeTxHash ||
    "pending";

  const receipt: Receipt = {
    id: input.id,
    buyerAgent: input.buyerAgent,
    sellerAgent: input.sellerAgent,
    service: input.service,
    amount: input.amountUsd.toFixed(2),
    currency: "USDC",
    network: "Arc",
    rail: input.rail,
    paymentMode: paymentMode(),
    paymentTxHash,
    captureTxHash: input.payment.captureTxHash,
    voidTxHash: input.payment.voidTxHash,
    verification: {
      status: !input.verification
        ? "SKIPPED"
        : input.verification.verified
          ? "PASSED"
          : "FAILED",
    },
    outcome: input.outcome,
    createdAt: new Date().toISOString(),
    explorerUrl: explorerTx(paymentTxHash),
  };
  receipts.set(receipt.id, receipt);
  return receipt;
}

export function getReceipt(id: string) {
  return receipts.get(id);
}

export function listReceipts() {
  return [...receipts.values()].reverse();
}

export function settledUsd() {
  return listReceipts()
    .filter((r) => r.outcome === "SUCCESS")
    .reduce((n, r) => n + Number(r.amount || 0), 0);
}
