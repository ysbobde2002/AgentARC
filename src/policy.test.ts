import { describe, expect, it } from "vitest";
import { captureTurn } from "./intent/capture.js";
import { parseIntent } from "./intent.js";
import { evaluatePolicy } from "./policy.js";
import { getSellerTrust } from "./trust.js";
import { SERVICES, sellerCoversIntent } from "./discovery.js";
import { verifyResponse } from "./verification.js";

describe("intent", () => {
  it("parses a nano ETH tick", () => {
    const i = parseIntent("Get me the current ETH price. Spend up to $0.05");
    expect(i.serviceType).toBe("financial-data");
    expect(i.asset).toBe("ETH");
    expect(i.maxSpendUsd).toBe(0.05);
  });

  it("parses a Shopify shopping prompt", () => {
    const i = parseIntent("Find me chocolates under $10");
    expect(i.serviceType).toBe("commerce");
    expect(i.channel).toBe("shopify");
    expect(i.maxSpendUsd).toBe(10);
  });

  it("does not treat a BTC historical ask as a live ETH tick", () => {
    const i = parseIntent("what is the bitcoin price at 9am on 26th august 2025");
    expect(i.asset).toBe("BTC");
    expect(sellerCoversIntent(i)).toBe(false);
  });

  it("parses an ETH OHLC chart request", () => {
    const i = parseIntent("Get ETH chart details. Spend up to $0.05");
    expect(i.serviceType).toBe("financial-data");
    expect(i.asset).toBe("ETH");
  });

  it("parses a research memo", () => {
    const i = parseIntent("Buy the ETH research memo. Spend up to $150");
    expect(i.serviceType).toBe("research");
    expect(i.maxSpendUsd).toBe(150);
  });
});

describe("intent capture", () => {
  it("is ready for chocolates under $10 without OpenAI", async () => {
    const turn = await captureTurn({ prompt: "Find me chocolates under $10" });
    expect(turn.ready).toBe(true);
    expect(turn.parsed.channel).toBe("shopify");
    expect(turn.parsed.query).toMatch(/chocolate/i);
  });

  it("is ready for an ETH price tick", async () => {
    const turn = await captureTurn({ prompt: "Get me the current ETH price. Spend up to $0.05" });
    expect(turn.ready).toBe(true);
    expect(turn.parsed.channel).toBe("digital");
    expect(turn.parsed.category).toBe("FINANCIAL_ANALYSIS");
  });
});

describe("policy rails", () => {
  const trust = getSellerTrust();
  const tick = SERVICES.find((s) => s.id === "market-data-eth")!;
  const ohlc = SERVICES.find((s) => s.id === "market-data-eth-ohlc")!;
  const memo = SERVICES.find((s) => s.id === "research-eth")!;

  it("routes a 0.01 tick to DIRECT nanopayment", () => {
    const p = evaluatePolicy({ maxSpendUsd: 0.05, service: tick, trust: { ...trust, recentFailures: 0 } });
    expect(p.decision).toBe("APPROVE");
    expect(p.rail).toBe("DIRECT");
  });

  it("routes a 0.02 OHLC chart to DIRECT nanopayment", () => {
    const p = evaluatePolicy({ maxSpendUsd: 0.05, service: ohlc, trust: { ...trust, recentFailures: 0 } });
    expect(p.decision).toBe("APPROVE");
    expect(p.rail).toBe("DIRECT");
  });

  it("routes a 100 memo to PROTECTED escrow", () => {
    const p = evaluatePolicy({ maxSpendUsd: 150, service: memo, trust: { ...trust, recentFailures: 0 } });
    expect(p.decision).toBe("APPROVE");
    expect(p.rail).toBe("PROTECTED");
  });

  it("rejects after repeated seller failures", () => {
    const p = evaluatePolicy({
      maxSpendUsd: 150,
      service: memo,
      trust: { ...trust, recentFailures: 3 },
    });
    expect(p.decision).toBe("REJECT");
  });

  it("rejects overspend", () => {
    const p = evaluatePolicy({ maxSpendUsd: 50, service: memo, trust });
    expect(p.decision).toBe("REJECT");
  });
});

describe("verification", () => {
  it("fails a malformed seller payload", () => {
    const v = verifyResponse({
      expectedAsset: "ETH",
      requestId: "req_1",
      response: {
        httpStatus: 200,
        requestId: "req_1",
        receivedAt: new Date().toISOString(),
        body: { service: "market-data", asset: "ETH", error: "malformed" },
      },
    });
    expect(v.verified).toBe(false);
    expect(v.checks.schema).toBe(false);
  });

  it("fails a Shopify merchant timeout", () => {
    const v = verifyResponse({
      expectedAsset: "chocolate",
      category: "commerce",
      requestId: "ord_1",
      response: {
        httpStatus: 500,
        requestId: "ord_1",
        receivedAt: new Date().toISOString(),
        body: { error: "merchant timeout" },
      },
    });
    expect(v.verified).toBe(false);
    expect(v.checks.httpStatus).toBe(false);
  });
});

describe("escrow settlement", () => {
  it("voids when verification fails", async () => {
    const { protectedSettlement } = await import("./escrow-flow.js");
    expect(protectedSettlement({ verified: false })).toBe("void");
  });

  it("holds until the buyer confirms receipt", async () => {
    const { protectedSettlement } = await import("./escrow-flow.js");
    expect(protectedSettlement({ verified: true })).toBe("hold");
    expect(protectedSettlement({ verified: true, received: true })).toBe("capture");
    expect(protectedSettlement({ verified: true, received: false })).toBe("void");
  });
});
