import { config } from "./config.js";
import type { PolicyResult, Service, TrustSignals } from "./types.js";

export function evaluatePolicy(input: {
  maxSpendUsd: number;
  service: Service;
  trust: TrustSignals;
  marketplaceMedianUsd?: number | null;
}): PolicyResult {
  const { maxSpendUsd, service, trust } = input;
  const reasons: string[] = [];

  if (!trust.identityVerified) {
    return {
      decision: "REJECT",
      rail: "DIRECT",
      protectionLevel: "DIRECT",
      reasons: ["Seller ERC-8004 identity missing — fail closed"],
    };
  }

  if (service.priceUsd > maxSpendUsd) {
    return {
      decision: "REJECT",
      rail: "DIRECT",
      protectionLevel: "DIRECT",
      reasons: [
        `Price ${service.priceUsd} USDC exceeds max spend ${maxSpendUsd} USDC`,
      ],
    };
  }

  if (trust.recentFailures >= 3) {
    return {
      decision: "REJECT",
      rail: "PROTECTED",
      protectionLevel: "PROTECTED_SETTLEMENT",
      reasons: [`Seller has ${trust.recentFailures} recent failures — fail closed`],
    };
  }

  if (trust.x402Supported) {
    reasons.push("Seller advertises x402 — nanopayment-capable");
  }
  if (trust.source === "erc-8004") {
    reasons.push(
      `Live ERC-8004 #${trust.agentId} · ${trust.reputationSignals} feedback · ${trust.validationSignals} validations`,
    );
  } else {
    reasons.push("Seller ERC-8004 identity available");
  }
  reasons.push(`Spend cap ${maxSpendUsd} USDC covers ${service.priceUsd} USDC`);

  if (input.marketplaceMedianUsd != null) {
    reasons.push(
      `Agent Marketplace median ${input.marketplaceMedianUsd.toFixed(4)} USDC vs our ${service.priceUsd} USDC`,
    );
  }

  const large = service.priceUsd >= config.policy.protectMinUsd;
  const nano =
    service.priceUsd <= config.policy.nanoMaxUsd &&
    service.delivery === "instant" &&
    service.objective;

  if (large || !service.objective || service.delivery === "lagged") {
    reasons.push(
      large
        ? `Amount ≥ ${config.policy.protectMinUsd} USDC — escrow, not a nanopayment`
        : "Service is lagged or subjective — hold funds until verification",
    );
    return {
      decision: "APPROVE",
      rail: "PROTECTED",
      protectionLevel: "PROTECTED_SETTLEMENT",
      reasons,
    };
  }

  if (nano) {
    reasons.push(
      `Amount ≤ ${config.policy.nanoMaxUsd} USDC, instant, objective — nanopayment, no escrow`,
    );
    return {
      decision: "APPROVE",
      rail: "DIRECT",
      protectionLevel: "DIRECT",
      reasons,
    };
  }

  reasons.push("Defaulting to protected settlement");
  return {
    decision: "APPROVE",
    rail: "PROTECTED",
    protectionLevel: "PROTECTED_SETTLEMENT",
    reasons,
  };
}
