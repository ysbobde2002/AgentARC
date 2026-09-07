import { describe, expect, it } from "vitest";
import { encodePaymentRequired, decodePaymentRequired, adapterPaymentPayload, isAdapterPayload } from "./x402.js";
import { nanoRequirements } from "./x402.js";
import { marketplacePriceBand, rankListings } from "./marketplace.js";

describe("x402 codec", () => {
  it("round-trips a Gateway nanopayment advertisement", () => {
    const body = nanoRequirements(0.01, "/charts/ETH");
    const header = encodePaymentRequired(body);
    const decoded = decodePaymentRequired(header);
    expect(decoded.x402Version).toBe(2);
    expect(decoded.accepts[0]?.extra?.name).toBe("GatewayWalletBatched");
    expect(decoded.accepts[0]?.network).toBe("eip155:5042002");
    expect(decoded.accepts[0]?.amount).toBe("10000");
  });

  it("marks adapter payloads", () => {
    const required = nanoRequirements(0.01, "/charts/ETH");
    const payload = adapterPaymentPayload(required, 0.01);
    expect(isAdapterPayload(payload)).toBe(true);
    expect(payload.accepted.scheme).toBe("exact");
  });
});

describe("marketplace ranking", () => {
  it("returns at most five listings that match ETH price intent", () => {
    const listings = [
      { resource: "a", name: "Sponge", category: "INFRASTRUCTURE", description: "CAPTCHA", priceUsd: 0.01, supportsCircleGateway: true, supportsVanillax402: true, networks: [] },
      { resource: "b", name: "AIsa API", category: "FINANCIAL_ANALYSIS", description: "Get cryptocurrency prices", priceUsd: 0.01, supportsCircleGateway: true, supportsVanillax402: true, networks: [] },
      { resource: "c", name: "Allium", category: "FINANCIAL_ANALYSIS", description: "ETH token price", priceUsd: 0.02, supportsCircleGateway: true, supportsVanillax402: true, networks: [] },
      { resource: "d", name: "AIsa API", category: "FINANCIAL_ANALYSIS", description: "Simple Price", priceUsd: 0.008, supportsCircleGateway: true, supportsVanillax402: true, networks: [] },
      { resource: "e", name: "Reservations", category: "INFRASTRUCTURE", description: "Book a table", priceUsd: 3, supportsCircleGateway: true, supportsVanillax402: true, networks: [] },
      { resource: "f", name: "Allium", category: "FINANCIAL_ANALYSIS", description: "Historical ETH OHLC", priceUsd: 0.02, supportsCircleGateway: true, supportsVanillax402: true, networks: [] },
      { resource: "g", name: "AIsa API", category: "FINANCIAL_ANALYSIS", description: "Coin Tickers", priceUsd: 0.008, supportsCircleGateway: true, supportsVanillax402: true, networks: [] },
    ];
    const ranked = rankListings(listings, "Get me the current ETH price. Spend up to $0.05", {
      serviceType: "financial-data",
      asset: "ETH",
    });
    expect(ranked).toHaveLength(5);
    expect(ranked.every((l) => l.category === "FINANCIAL_ANALYSIS")).toBe(true);
  });
});

describe("marketplace price band", () => {
  it("computes a median", () => {
    const band = marketplacePriceBand([
      { resource: "a", name: "a", category: "x", description: "", priceUsd: 0.01, supportsCircleGateway: true, supportsVanillax402: true, networks: [] },
      { resource: "b", name: "b", category: "x", description: "", priceUsd: 0.02, supportsCircleGateway: true, supportsVanillax402: true, networks: [] },
      { resource: "c", name: "c", category: "x", description: "", priceUsd: 0.03, supportsCircleGateway: true, supportsVanillax402: true, networks: [] },
    ]);
    expect(band.medianUsd).toBe(0.02);
    expect(band.sample).toBe(3);
  });
});
