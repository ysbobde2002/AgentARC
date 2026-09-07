import { describe, expect, it } from "vitest";
import { mapScanAgent } from "./trust.js";

describe("ERC-8004 scan mapping", () => {
  it("maps a live buyer record into policy signals without a single score", () => {
    const trust = mapScanAgent(
      {
        token_id: "9638",
        name: "craidt-buyer-agent",
        is_active: true,
        total_feedbacks: 9,
        total_validations: 0,
        successful_validations: 0,
        x402_supported: true,
        contract_address: "0x8004A818BFB912233c491871b3d84c89A494BD9e",
        chain_id: 11155111,
      },
      "buyer",
      0,
      "live",
    );
    expect(trust.identityVerified).toBe(true);
    expect(trust.source).toBe("erc-8004");
    expect(trust.reputationSignals).toBe(9);
    expect(trust.validationSignals).toBe(0);
    expect(trust.x402Supported).toBe(true);
    expect(trust.scanUrl).toContain("/agents/sepolia/9638");
    expect(trust.scanUrl).toContain("testnet.8004scan.io");
  });

  it("keeps seller #6832 verified even with zero feedback", () => {
    const trust = mapScanAgent(
      {
        token_id: "6832",
        name: "Agent #6832",
        is_active: true,
        total_feedbacks: 0,
        total_validations: 0,
        x402_supported: true,
        chain_id: 11155111,
      },
      "seller",
      0,
      "live",
    );
    expect(trust.identityVerified).toBe(true);
    expect(trust.reputationSignals).toBe(0);
    expect(trust.x402Supported).toBe(true);
  });

  it("falls back to adapter identity when scan is unavailable", () => {
    const trust = mapScanAgent(null, "seller", 1, "adapter");
    expect(trust.identityVerified).toBe(true);
    expect(trust.source).toBe("adapter");
    expect(trust.recentFailures).toBe(1);
  });
});
