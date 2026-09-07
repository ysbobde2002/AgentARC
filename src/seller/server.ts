import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { advertiseNanopayment, settleNanopayment } from "../circle/nanopayments.js";
import { config } from "../config.js";
import { getMarketQuote, getOhlc, getResearchMemo } from "../market-data.js";
import { routeByPath, SELLER_ROUTES, sellerCatalogListings } from "./catalog.js";

function send(
  res: ServerResponse,
  status: number,
  body: unknown,
  extra: Record<string, string> = {},
) {
  res.writeHead(status, {
    "Content-Type": "application/json",
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Headers": "Content-Type, PAYMENT-SIGNATURE, Payment-Signature",
    "Access-Control-Expose-Headers": "PAYMENT-REQUIRED",
    ...extra,
  });
  res.end(JSON.stringify(body, null, 2));
}

function paymentHeader(req: IncomingMessage) {
  return (
    (req.headers["payment-signature"] as string | undefined) ||
    (req.headers["PAYMENT-SIGNATURE"] as string | undefined)
  );
}

/** Arc x402 seller: unpaid GETs return HTTP 402, then settle and serve the quote. */
export async function handleSellerRequest(
  req: IncomingMessage,
  res: ServerResponse,
  url: URL,
) {
  if (req.method === "OPTIONS") {
    res.writeHead(204, {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "GET,OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type, PAYMENT-SIGNATURE, Payment-Signature",
    });
    res.end();
    return;
  }

  const path = url.pathname.replace(/\/$/, "") || "/";
  const fail = url.searchParams.get("fail") === "1";

  if (path === "/health") {
    send(res, 200, {
      ok: true,
      role: "x402-seller",
      network: config.arc.caip2,
      usdc: config.arc.usdc,
      agentId: config.identity.sellerAgentId,
      routes: SELLER_ROUTES.map((r) => ({ path: r.path, priceUsd: r.priceUsd, x402: r.x402 })),
    });
    return;
  }

  if (path === "/catalog") {
    send(res, 200, {
      seller: config.identity.sellerName,
      agentId: config.identity.sellerAgentId,
      network: config.arc.caip2,
      listings: sellerCatalogListings(),
    });
    return;
  }

  const route = routeByPath(path);
  if (!route) {
    send(res, 404, { error: "unknown seller resource" });
    return;
  }

  if (route.x402 && req.method === "GET") {
    const signature = paymentHeader(req);
    if (!signature) {
      const adv = await advertiseNanopayment(route.priceUsd, `${config.seller.origin}${route.path}`);
      send(res, 402, { error: "Payment Required", ...adv.body }, adv.headers);
      return;
    }
    let settled;
    try {
      settled = await settleNanopayment(signature, route.priceUsd);
    } catch (err) {
      send(res, 402, { error: err instanceof Error ? err.message : "settle failed" });
      return;
    }
    if (!settled.ok) {
      send(res, 402, { error: settled.evidence.note || "Invalid payment" });
      return;
    }
    const quote =
      path.endsWith("/ohlc")
        ? await getOhlc("ETH", fail)
        : await getMarketQuote("ETH", fail);
    send(res, 200, { ...quote.body, payment: settled.evidence, payer: settled.payer });
    return;
  }

  if (path.startsWith("/research/") && req.method === "GET") {
    const memo = await getResearchMemo("ETH", fail);
    send(res, memo.httpStatus, memo.body);
    return;
  }

  send(res, 405, { error: "method not allowed" });
}

export function startSellerServer(port = config.seller.port) {
  const server = createServer(async (req, res) => {
    const url = new URL(req.url || "/", `http://${req.headers.host}`);
    try {
      await handleSellerRequest(req, res, url);
    } catch (err) {
      send(res, 500, { error: err instanceof Error ? err.message : "seller error" });
    }
  });
  server.listen(port, () => {
    console.log(`Arc x402 seller           → http://localhost:${port}`);
    console.log(`  GET /charts/ETH         → 402 then ETH spot (0.01 USDC)`);
    console.log(`  GET /charts/ETH/ohlc    → 402 then ETH candles (0.02 USDC)`);
  });
  return server;
}
