import { config } from "../config.js";
import type { MarketplaceListing } from "../marketplace.js";
import type { Service } from "../types.js";

export type SellerRoute = {
  path: string;
  priceUsd: number;
  x402: boolean;
  service: Service;
};

export const SELLER_ROUTES: SellerRoute[] = [
  {
    path: "/charts/ETH",
    priceUsd: 0.01,
    x402: true,
    service: {
      id: "market-data-eth",
      name: "Market Data · ETH tick",
      category: "financial-data",
      endpoint: "/charts/ETH",
      priceUsd: 0.01,
      currency: "USDC",
      network: "Arc",
      sellerAgentId: config.identity.sellerAgentId,
      delivery: "instant",
      objective: true,
    },
  },
  {
    path: "/charts/ETH/ohlc",
    priceUsd: 0.02,
    x402: true,
    service: {
      id: "market-data-eth-ohlc",
      name: "Market Data · ETH OHLC",
      category: "financial-data",
      endpoint: "/charts/ETH/ohlc",
      priceUsd: 0.02,
      currency: "USDC",
      network: "Arc",
      sellerAgentId: config.identity.sellerAgentId,
      delivery: "instant",
      objective: true,
    },
  },
  {
    path: "/research/ETH",
    priceUsd: 100,
    x402: false,
    service: {
      id: "research-eth",
      name: "Market Research · ETH memo",
      category: "research",
      endpoint: "/research/ETH",
      priceUsd: 100,
      currency: "USDC",
      network: "Arc",
      sellerAgentId: config.identity.sellerAgentId,
      delivery: "lagged",
      objective: false,
    },
  },
];

export function sellerCatalogListings(): MarketplaceListing[] {
  return SELLER_ROUTES.filter((r) => r.x402).map((r) => ({
    resource: r.path,
    name: "Arc Chart Seller",
    category: "FINANCIAL_ANALYSIS",
    description: r.service.name,
    priceUsd: r.priceUsd,
    supportsCircleGateway: true,
    supportsVanillax402: true,
    networks: [config.arc.caip2],
    advertisedNetwork: config.arc.caip2,
    method: "GET",
  }));
}

export function routeByPath(path: string): SellerRoute | undefined {
  return SELLER_ROUTES.find((r) => r.path === path);
}
