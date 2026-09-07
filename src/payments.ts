import { authorizeEscrow, captureEscrow, voidEscrow } from "./circle/escrow.js";
import { createNanopaymentAuthorization } from "./circle/nanopayments.js";
import { config, paymentMode } from "./config.js";
import type { PaymentEvidence, Rail } from "./types.js";

export { authorizeEscrow, captureEscrow, voidEscrow };

/**
 * Nanopayments rail — x402 402 handshake + Circle Gateway batched settlement.
 * When CIRCLE_API_KEY is present the buyer Agent Wallet signs EIP-3009.
 * Without keys we run a labeled adapter payload so the UI is complete.
 */
export async function executeNanopayment(
  amountUsd: number,
  paymentRequiredHeader?: string,
): Promise<{ evidence: PaymentEvidence; paymentHeader: string }> {
  if (!paymentRequiredHeader) {
    const { nanoRequirements, encodePaymentRequired } = await import("./x402.js");
    paymentRequiredHeader = encodePaymentRequired(
      nanoRequirements(amountUsd, `${config.arc.caip2}/api/crypto/ETH`),
    );
  }
  const paid = await createNanopaymentAuthorization(paymentRequiredHeader, amountUsd);
  return { evidence: paid.evidence, paymentHeader: paid.header };
}

export function railLabel(rail: Rail) {
  return rail === "DIRECT" ? "Nanopayment · instant" : "AuthCapture escrow";
}

export function networkReady() {
  return {
    network: config.arc.network,
    chainId: config.arc.chainId,
    caip2: config.arc.caip2,
    usdc: config.arc.usdc,
    escrowConfigured: Boolean(config.arc.escrow),
    circleConfigured: paymentMode() === "circle",
    gateway: config.arc.gatewayWallet,
  };
}
