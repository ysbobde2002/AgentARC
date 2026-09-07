import { createServer } from "node:http";
import { existsSync, readFileSync } from "node:fs";
import { extname, join } from "node:path";
import { startSellerServer } from "../src/seller/server.js";
import { gasRail } from "../src/circle/paymaster.js";
import { agentWallets, walletSnapshots } from "../src/circle/wallets.js";
import { config, ROOT_DIR, paymentMode } from "../src/config.js";
import { SERVICES, discoverCatalog, runTurn } from "../src/discovery.js";
import { discoverMarketplace } from "../src/marketplace.js";
import { architecture, executePurchase, health, settlePurchase } from "../src/orchestrator.js";
import { getReceipt, listReceipts } from "../src/receipts.js";
import { loadBuyerTrust, loadSellerTrust } from "../src/trust.js";

const MIME: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json",
  ".svg": "image/svg+xml",
  ".png": "image/png",
};

async function readJson(req: import("node:http").IncomingMessage) {
  const chunks: Buffer[] = [];
  for await (const c of req) chunks.push(c as Buffer);
  if (!chunks.length) return {};
  return JSON.parse(Buffer.concat(chunks).toString("utf8"));
}

function send(
  res: import("node:http").ServerResponse,
  status: number,
  body: unknown,
  type = "application/json",
  extra: Record<string, string> = {},
) {
  const payload =
    typeof body === "string" || Buffer.isBuffer(body)
      ? body
      : JSON.stringify(body, null, 2);
  res.writeHead(status, {
    "Content-Type": type,
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Headers": "Content-Type, PAYMENT-SIGNATURE, Payment-Signature",
    "Cache-Control": type.startsWith("text/") ? "no-store" : "public, max-age=0",
    ...extra,
  });
  res.end(payload);
}

function friendlyPayError(message: string): string {
  const lower = message.toLowerCase();
  if (lower.includes("insufficient") || lower.includes("asset amount owned")) {
    return "Your Agent Wallet does not have enough USDC for this purchase. The ETH research memo is $100 escrow; Arc Testnet faucet is https://faucet.circle.com";
  }
  if (lower.includes("api parameter invalid")) {
    return "Circle rejected that wallet call. Escrow now uses Agent Wallet USDC transfers (buyer → operator → seller) instead of contract execution.";
  }
  return message;
}

const uiRoot = join(ROOT_DIR, "ui");

async function proxySeller(
  req: import("node:http").IncomingMessage,
  res: import("node:http").ServerResponse,
  sellerPath: string,
) {
  const headers: Record<string, string> = { Accept: "application/json" };
  const signature =
    (req.headers["payment-signature"] as string | undefined) ||
    (req.headers["PAYMENT-SIGNATURE"] as string | undefined);
  if (signature) headers["PAYMENT-SIGNATURE"] = signature;
  const upstream = await fetch(`${config.seller.origin}${sellerPath}`, {
    headers,
    signal: AbortSignal.timeout(20_000),
  });
  const extra: Record<string, string> = {};
  const required = upstream.headers.get("PAYMENT-REQUIRED") || upstream.headers.get("payment-required");
  if (required) extra["PAYMENT-REQUIRED"] = required;
  const body = await upstream.json().catch(() => ({ error: "seller unavailable" }));
  send(res, upstream.status, body, "application/json", extra);
}

const server = createServer(async (req, res) => {
  const url = new URL(req.url || "/", `http://${req.headers.host}`);
  const path = url.pathname;

  if (req.method === "OPTIONS") {
    res.writeHead(204, {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "GET,POST,OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type, PAYMENT-SIGNATURE, Payment-Signature",
    });
    res.end();
    return;
  }

  try {
    if (path === "/api/health") {
      send(res, 200, health());
      return;
    }

    if (path === "/api/architecture") {
      send(res, 200, architecture());
      return;
    }

    if (path === "/api/services") {
      send(res, 200, SERVICES);
      return;
    }

    if (path === "/api/marketplace") {
      const market = await discoverMarketplace({
        query: url.searchParams.get("query") || undefined,
        category: url.searchParams.get("category") || undefined,
        limit: Number(url.searchParams.get("limit") || 5),
      });
      send(res, 200, market);
      return;
    }

    if (path === "/api/wallets") {
      send(res, 200, { paymentMode: paymentMode(), gas: gasRail(), ...(await agentWallets()), wallets: await walletSnapshots() });
      return;
    }

    if (path === "/api/identities") {
      const [buyer, seller] = await Promise.all([loadBuyerTrust(), loadSellerTrust()]);
      send(res, 200, {
        buyer,
        seller,
        paymentMode: paymentMode(),
        network: config.arc,
        gas: gasRail(),
        wallets: await agentWallets(),
      });
      return;
    }

    if (path === "/api/crypto/ETH" && req.method === "GET") {
      await proxySeller(req, res, "/charts/ETH" + url.search);
      return;
    }

    if (path === "/api/research/ETH" && req.method === "GET") {
      await proxySeller(req, res, "/research/ETH" + url.search);
      return;
    }

    if (path === "/api/discover" && req.method === "POST") {
      const body = (await readJson(req)) as { prompt?: string };
      send(res, 200, await discoverCatalog(String(body.prompt || "")));
      return;
    }

    if (path === "/api/turn" && req.method === "POST") {
      const body = (await readJson(req)) as {
        prompt?: string;
        sessionId?: string | null;
        category?: string;
      };
      send(
        res,
        200,
        await runTurn({
          prompt: String(body.prompt || ""),
          sessionId: body.sessionId,
          category: body.category,
        }),
      );
      return;
    }

    if (path === "/api/transactions" && req.method === "POST") {
      const body = (await readJson(req)) as {
        prompt?: string;
        maxSpendUsd?: number;
        simulateFailure?: boolean;
        shopifyOffer?: {
          productId: string;
          title: string;
          merchantName: string;
          priceCents: number;
          imageUrl?: string;
          source?: "shopify-ucp" | "fallback";
        };
        marketplaceListing?: {
          resource: string;
          name: string;
          category: string;
          description: string;
          priceUsd: number | null;
          supportsCircleGateway: boolean;
          supportsVanillax402: boolean;
          networks: string[];
          advertisedNetwork: string | null;
          method: string;
        };
      };
      try {
        const result = await executePurchase({
          prompt: String(body.prompt || ""),
          maxSpendUsd: body.maxSpendUsd,
          simulateFailure: Boolean(body.simulateFailure),
          shopifyOffer: body.shopifyOffer,
          marketplaceListing: body.marketplaceListing,
        });
        send(res, 200, result);
      } catch (err) {
        const { circleErrorMessage } = await import("../src/circle/client.js");
        send(res, 200, { error: friendlyPayError(circleErrorMessage(err)) });
      }
      return;
    }

    if (path.match(/^\/api\/transactions\/[^/]+\/settle$/) && req.method === "POST") {
      const runId = path.split("/")[3] || "";
      const body = (await readJson(req)) as { received?: boolean };
      if (typeof body.received !== "boolean") {
        send(res, 200, { error: "received must be true (release to seller) or false (refund buyer)" });
        return;
      }
      try {
        const result = await settlePurchase(runId, body.received);
        send(res, 200, result);
      } catch (err) {
        const { circleErrorMessage } = await import("../src/circle/client.js");
        send(res, 200, { error: friendlyPayError(circleErrorMessage(err)) });
      }
      return;
    }

    if (path.startsWith("/api/transactions/") && req.method === "GET") {
      const id = path.split("/").pop() || "";
      const receipt = getReceipt(id);
      if (!receipt) {
        send(res, 404, { error: "not found" });
        return;
      }
      send(res, 200, receipt);
      return;
    }

    if (path === "/api/receipts" && req.method === "GET") {
      send(res, 200, listReceipts());
      return;
    }

    let file = path === "/" ? "/index.html" : path;
    if (path === "/architecture") file = "/architecture.html";
    const disk = join(uiRoot, file.replace(/^\/+/, ""));
    if (!disk.startsWith(uiRoot) || !existsSync(disk)) {
      send(res, 404, { error: "not found" });
      return;
    }
    const type = MIME[extname(disk)] || "application/octet-stream";
    send(res, 200, readFileSync(disk), type);
  } catch (err) {
    const axiosData =
      err && typeof err === "object" && "response" in err
        ? (err as { response?: { data?: { message?: string } } }).response?.data
        : undefined;
    send(res, 500, {
      error: axiosData?.message || (err instanceof Error ? err.message : "server error"),
    });
  }
});

startSellerServer(config.seller.port);

server.listen(config.port, "0.0.0.0", () => {
  console.log(`Buyer / orchestrator    → http://0.0.0.0:${config.port}`);
  console.log(`Arc x402 seller         → http://127.0.0.1:${config.seller.port}`);
  console.log(`Architecture            → http://0.0.0.0:${config.port}/architecture`);
  console.log(`Payment mode: ${paymentMode()}`);
  console.log(`Network: ${config.arc.name} (${config.arc.caip2})`);
});
