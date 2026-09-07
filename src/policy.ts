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
      reasons: ["Seller ERC-8004 identity is missing, so payment is blocked."],
    };
  }

  if (service.priceUsd > maxSpendUsd) {
    return {
      decision: "REJECT",
      rail: "DIRECT",
      protectionLevel: "DIRECT",
      reasons: [
        `Price ${service.priceUsd} USDC exceeds the ${maxSpendUsd} USDC spend cap.`,
      ],
    };
  }

  if (trust.recentFailures >= 3) {
    return {
      decision: "REJECT",
      rail: "PROTECTED",
      protectionLevel: "PROTECTED_SETTLEMENT",
      reasons: [`Seller has ${trust.recentFailures} recent failures, so payment is blocked.`],
    };
  }

  if (trust.x402Supported) {
    reasons.push("Seller supports x402 nanopayments.");
  }
  if (trust.source === "erc-8004") {
    reasons.push(
      `Seller ERC-8004 identity #${trust.agentId} is live, with ${trust.reputationSignals} feedback and ${trust.validationSignals} validations.`,
    );
  } else {
    reasons.push("Seller ERC-8004 identity is available.");
  }
  reasons.push(`Spend cap of ${maxSpendUsd} USDC covers the ${service.priceUsd} USDC price.`);

  if (input.marketplaceMedianUsd != null) {
    reasons.push(
      `Circle marketplace median is ${input.marketplaceMedianUsd.toFixed(4)} USDC versus our ${service.priceUsd} USDC price.`,
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
        ? `Amount is ${config.policy.protectMinUsd} USDC or more, so this uses escrow instead of a nanopayment.`
        : "Delivery is lagged or subjective, so funds stay in escrow until verification.",
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
      `Amount is ${config.policy.nanoMaxUsd} USDC or less and the result is instant, so this is a nanopayment.`,
    );
    return {
      decision: "APPROVE",
      rail: "DIRECT",
      protectionLevel: "DIRECT",
      reasons,
    };
  }

  reasons.push("Defaulting to protected escrow.");
  return {
    decision: "APPROVE",
    rail: "PROTECTED",
    protectionLevel: "PROTECTED_SETTLEMENT",
    reasons,
  };
}
