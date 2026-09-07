import { randomUUID } from "node:crypto";
import { gasRail } from "./circle/paymaster.js";
import { config, paymentMode } from "./config.js";
import { discoverService, sellerCoversIntent } from "./discovery.js";
import { parseIntent } from "./intent.js";
import { discoverMarketplace, listingToService, marketplacePriceBand } from "./marketplace.js";
import { fetchSellerResource, paySellerX402 } from "./seller/client.js";
import { authorizeEscrow, captureEscrow, voidEscrow } from "./payments.js";
import { protectedSettlement } from "./escrow-flow.js";
import { evaluatePolicy } from "./policy.js";
import { buildReceipt } from "./receipts.js";
import { loadBuyerTrust, loadSellerTrust, recordSellerFailure, recordSellerSuccess } from "./trust.js";
import { offerToService } from "./ucp.js";
import type {
  ExecuteInput,
  ExecuteResult,
  FeedMessage,
  Intent,
  MarketplaceSignal,
  Outcome,
  PaymentEvidence,
  PolicyResult,
  SellerResponse,
  Service,
  Stage,
  TimelineEvent,
  TrustSignals,
  VerificationResult,
} from "./types.js";
import { verifyResponse } from "./verification.js";

type PendingRun = {
  runId: string;
  intent: Intent;
  service: Service;
  buyerTrust: TrustSignals;
  sellerTrust: TrustSignals;
  policy: PolicyResult;
  payment: PaymentEvidence;
  verification: VerificationResult;
  seller: SellerResponse;
  marketplace: MarketplaceSignal;
  stages: Stage[];
  buyerMessages: FeedMessage[];
  sellerMessages: FeedMessage[];
  timeline: TimelineEvent[];
};

const pendingRuns = new Map<string, PendingRun>();

function stage(id: string, label: string, detail: string, status: Stage["status"] = "complete"): Stage {
  return { id, label, status, detail };
}

async function fulfillShopify(service: { name: string; id: string }, fail: boolean) {
  const requestId = `ord_${Date.now().toString(36)}`;
  if (fail) {
    return { httpStatus: 500, requestId, body: { error: "merchant timeout" } };
  }
  return {
    httpStatus: 200,
    requestId,
    body: {
      orderId: requestId,
      title: service.name,
      service: "shopify-ucp",
      requestId,
      timestamp: new Date().toISOString(),
    },
  };
}

export async function executePurchase(input: ExecuteInput): Promise<ExecuteResult> {
  const runId = `run_${randomUUID().slice(0, 8)}`;
  const intent = parseIntent(input.prompt, input.maxSpendUsd);
  const [buyerTrust, sellerTrust] = await Promise.all([loadBuyerTrust(), loadSellerTrust()]);
  const buyerMessages: FeedMessage[] = [];
  const sellerMessages: FeedMessage[] = [];
  const timeline: TimelineEvent[] = [];
  const stages: Stage[] = [];

  const pushBuyer = (phase: string, message: FeedMessage) => {
    buyerMessages.push(message);
    timeline.push({ phase, side: "buyer", message });
  };
  const pushSeller = (phase: string, message: FeedMessage) => {
    sellerMessages.push(message);
    timeline.push({ phase, side: "seller", message });
  };

  const done = (extra: Partial<ExecuteResult> = {}): ExecuteResult => ({
    runId,
    intent,
    service: extra.service ?? null,
    trust: extra.trust ?? null,
    policy: extra.policy!,
    stages,
    seller: extra.seller ?? null,
    verification: extra.verification ?? null,
    payment: extra.payment ?? null,
    receipt: extra.receipt ?? null,
    marketplace: extra.marketplace ?? null,
    buyerMessages,
    sellerMessages,
    timeline,
    awaitingDelivery: extra.awaitingDelivery,
  });

  pushBuyer("intent", { kind: "out", text: intent.raw });
  stages.push(
    stage("intent", "Intent understood", `${intent.serviceType} · ${intent.asset} · max ${intent.maxSpendUsd} USDC`),
  );
  pushBuyer("intent", {
    kind: "inc",
    text: `Intent\nService: ${intent.serviceType}\nAsset: ${intent.asset}\nMax spend: ${intent.maxSpendUsd} USDC`,
  });

  const service = input.shopifyOffer
    ? offerToService({
        ...input.shopifyOffer,
        source: input.shopifyOffer.source || "fallback",
        imageUrl: input.shopifyOffer.imageUrl || "",
      })
    : input.marketplaceListing
      ? listingToService(input.marketplaceListing)
      : discoverService(intent.serviceType, intent.asset, intent.raw);
  const commerce = Boolean(input.shopifyOffer) || service?.category === "commerce";
  const market = commerce
    ? {
        source: "unavailable" as const,
        total: 0,
        listings: [] as Awaited<ReturnType<typeof discoverMarketplace>>["listings"],
        deterministic: false as const,
        endpoint: "",
        fetchedAt: new Date().toISOString(),
      }
    : await discoverMarketplace({
        query: intent.asset,
        limit: 50,
      });
  const band = marketplacePriceBand(market.listings);
  const marketplace: MarketplaceSignal = {
    source: market.source,
    total: market.total,
    medianUsd: band.medianUsd,
    sample: band.sample,
    deterministic: false,
    listings: market.listings.slice(0, 4).map((l) => ({
      name: l.name,
      priceUsd: l.priceUsd,
      resource: l.resource,
    })),
  };

  if (!service) {
    stages.push(stage("discover", "No service found", "Registry returned nothing", "failed"));
    return done({
      marketplace,
      policy: {
        decision: "REJECT",
        rail: "DIRECT",
        protectionLevel: "DIRECT",
        reasons: ["No matching service"],
      },
    });
  }

  if (!sellerCoversIntent(intent)) {
    const reasons = [
      "This Arc x402 seller only quotes live ETH spot and OHLC. It does not serve BTC or historical prints — no payment sent.",
    ];
    stages.push(stage("discover", "Seller cannot fill this ask", reasons[0]!, "failed"));
    pushBuyer("discover", { kind: "sys", text: reasons[0]! });
    const policy = {
      decision: "REJECT" as const,
      rail: "DIRECT" as const,
      protectionLevel: "DIRECT" as const,
      reasons,
    };
    const receipt = buildReceipt({
      id: runId,
      buyerAgent: buyerTrust.agentId,
      sellerAgent: sellerTrust.agentId,
      service: service.id,
      amountUsd: 0,
      rail: "DIRECT",
      payment: { mode: "adapter", rail: "DIRECT", scheme: "nanopayments", amountUsd: 0 },
      verification: null,
      outcome: "REJECTED",
    });
    return done({ service, trust: sellerTrust, policy, receipt, marketplace });
  }

  stages.push(stage("discover", "Service discovered", `${service.name} · ${service.priceUsd} USDC`));
  pushBuyer("discover", {
    kind: "inc",
    text: `Discovered ${service.name}\n${service.priceUsd} USDC · Arc · ${service.endpoint}`,
  });
  if (market.source === "live") {
    pushBuyer("discover", {
      kind: "inc",
      text: `Circle Agent Marketplace\n${market.total} ${intent.serviceType === "research" ? "research" : "financial"} listings\nMedian ${band.medianUsd?.toFixed(4) ?? "—"} USDC`,
    });
  }
  pushSeller("discover", { kind: "sys", text: `Listed · ${service.name}` });
  pushSeller("discover", {
    kind: "inc",
    text: `Buyer agent requested ${service.endpoint}\nPrice: ${service.priceUsd} USDC`,
  });

  stages.push(
    stage(
      "trust",
      "ERC-8004 identity checked",
      `${sellerTrust.name} #${sellerTrust.agentId} · ${sellerTrust.source || "adapter"} · identity ${sellerTrust.identityVerified ? "yes" : "no"} · ${sellerTrust.reputationSignals} reputation signals · ${sellerTrust.recentFailures} recent failures`,
    ),
  );
  pushBuyer("trust", {
    kind: "inc",
    text: `ERC-8004\nIdentity: ${sellerTrust.identityVerified ? "available" : "missing"}\nSource: ${sellerTrust.source || "adapter"}\nx402: ${sellerTrust.x402Supported ? "yes" : "no"}\nReputation signals: ${sellerTrust.reputationSignals}\nValidation signals: ${sellerTrust.validationSignals}\nRecent failures: ${sellerTrust.recentFailures}\nNot a single trust score`,
  });

  const policy = evaluatePolicy({
    maxSpendUsd: intent.maxSpendUsd,
    service,
    trust: sellerTrust,
    marketplaceMedianUsd: band.medianUsd,
  });
  stages.push({
    id: "policy",
    label:
      policy.decision === "REJECT"
        ? "Transaction rejected"
        : policy.rail === "DIRECT"
          ? "Policy · DIRECT nanopayment"
          : "Policy · PROTECTED escrow",
    status: policy.decision === "REJECT" ? "failed" : "complete",
    detail: policy.reasons.join(" · "),
    rail: policy.rail,
  });
  pushBuyer("policy", {
    kind: "card",
    text: "Policy",
    card: {
      Decision: policy.decision,
      Rail: policy.rail === "DIRECT" ? "Nanopayment (instant)" : "AuthCapture escrow",
      Reason: policy.reasons[0] ?? "",
      Gas: gasRail().product,
    },
  });

  if (policy.decision === "REJECT") {
    pushBuyer("policy", { kind: "sys", text: "Fail closed. No payment sent." });
    const receipt = buildReceipt({
      id: runId,
      buyerAgent: buyerTrust.agentId,
      sellerAgent: sellerTrust.agentId,
      service: service.id,
      amountUsd: service.priceUsd,
      rail: policy.rail,
      payment: {
        mode: "adapter",
        rail: policy.rail,
        scheme: "nanopayments",
        amountUsd: 0,
      },
      verification: null,
      outcome: "REJECTED",
    });
    return done({ service, trust: sellerTrust, policy, receipt, marketplace });
  }

  let payment: PaymentEvidence;
  let sellerResponse: SellerResponse;

  if (policy.rail === "DIRECT") {
    const paid = await paySellerX402(service.endpoint, service.priceUsd, Boolean(input.simulateFailure));
    payment = paid.payment;
    sellerResponse = paid.seller;
    stages.push(
      stage("pay", "Nanopayment authorized", `${service.priceUsd} USDC via Circle Nanopayments / x402 + Gateway`),
    );
    stages.push(stage("settle", "Instant settlement", "Seller credited immediately · Arc batch later"));
    pushBuyer("pay", {
      kind: "inc",
      text: `x402 402 Payment Required\n${service.priceUsd} USDC nanopayment\nGateway domain ${config.arc.gatewayDomain} · Arc batch later`,
    });
    pushSeller("pay", {
      kind: "inc",
      text: "402 Payment Required → PAYMENT-SIGNATURE accepted\nServe immediately",
    });
  } else {
    payment = await authorizeEscrow(service.priceUsd);
    stages.push(
      stage("pay", "USDC authorized into escrow", `${service.priceUsd} USDC held on Arc · not captured`),
    );
    pushBuyer("pay", {
      kind: "inc",
      text: `AuthCapture\n${service.priceUsd} USDC locked in escrow\nSeller cannot spend until verification`,
    });
    pushSeller("pay", {
      kind: "inc",
      text: "Authorization seen on Arc\nDeliverable required before capture",
    });
    const raw =
      service.category === "commerce"
        ? await fulfillShopify(service, Boolean(input.simulateFailure))
        : await fetchSellerResource(service.endpoint, Boolean(input.simulateFailure));
    sellerResponse = {
      httpStatus: raw.httpStatus,
      body: raw.body,
      requestId: raw.requestId,
      receivedAt: new Date().toISOString(),
    };
  }

  stages.push(
    stage(
      "service",
      sellerResponse.httpStatus === 200 ? "Service responded" : "Service failed",
      `HTTP ${sellerResponse.httpStatus} · ${sellerResponse.requestId}`,
      sellerResponse.httpStatus === 200 ? "complete" : "failed",
    ),
  );
  pushSeller("service", {
    kind: "inc",
    text:
      service.category === "research"
        ? `Research memo dispatched\n${String(sellerResponse.body.summary ?? "invalid payload").slice(0, 180)}`
        : service.category === "commerce"
          ? `Shopify UCP order ${String(sellerResponse.body.orderId ?? "failed")}\n${service.name}`
          : `Quote\n${intent.asset} ${sellerResponse.body.price ?? "—"}\n${sellerResponse.requestId}`,
  });

  const verification = verifyResponse({
    response: sellerResponse,
    requestId: sellerResponse.requestId,
    expectedAsset: intent.asset,
    category: service.category,
  });

  stages.push({
    id: "verify",
    label: verification.verified ? "Response verified" : "Verification failed",
    status: verification.verified ? "complete" : "failed",
    detail: verification.verified
      ? "Independent checks passed (not seller-attested)"
      : "Independent verifier rejected the payload",
  });
  pushBuyer("verify", {
    kind: "card",
    text: "Verification",
    card: Object.fromEntries(
      Object.entries(verification.checks).map(([k, v]) => [k, v ? "pass" : "fail"]),
    ),
  });

  let outcome: Outcome = "SUCCESS";
  if (policy.rail === "PROTECTED") {
    const next = protectedSettlement({ verified: verification.verified });
    if (next === "hold") {
      stages.push(
        stage("settle", "Waiting on delivery", "USDC held by operator · capture only after you confirm receipt", "pending"),
      );
      pushBuyer("settle", {
        kind: "inc",
        text: "Escrow is holding USDC with the operator until you confirm delivery.",
      });
      pushSeller("settle", { kind: "sys", text: "Authorized · waiting for buyer delivery confirmation" });
      const receipt = buildReceipt({
        id: runId,
        buyerAgent: buyerTrust.agentId,
        sellerAgent: sellerTrust.agentId,
        service: service.id,
        amountUsd: service.priceUsd,
        rail: policy.rail,
        payment,
        verification,
        outcome: "HELD",
      });
      stages.push(stage("receipt", "Receipt issued", `${receipt.amount} USDC · escrow · HELD`));
      pushBuyer("receipt", {
        kind: "card",
        text: "Receipt",
        card: {
          Service: service.name,
          Amount: `${receipt.amount} USDC`,
          Rail: "Escrow",
          Network: "Arc",
          Status: "HELD",
          Verification: receipt.verification.status,
          Tx: `${receipt.paymentTxHash.slice(0, 18)}…`,
          Mode: receipt.paymentMode,
        },
      });
      pendingRuns.set(runId, {
        runId,
        intent,
        service,
        buyerTrust,
        sellerTrust,
        policy,
        payment,
        verification,
        seller: sellerResponse,
        marketplace,
        stages: [...stages],
        buyerMessages: [...buyerMessages],
        sellerMessages: [...sellerMessages],
        timeline: [...timeline],
      });
      return done({
        service,
        trust: sellerTrust,
        policy,
        seller: sellerResponse,
        verification,
        payment,
        receipt,
        marketplace,
        awaitingDelivery: true,
      });
    }
    payment = await voidEscrow(payment);
    stages.push(
      stage("settle", "Voided on Arc", "Buyer restored · never captured · seller was not paid", "failed"),
    );
    pushSeller("settle", { kind: "sys", text: "Void · escrow returned to buyer" });
    recordSellerFailure();
    outcome = "VOIDED";
  } else if (!verification.verified) {
    const sent = Boolean(payment.settleTxHash || payment.authorizeTxHash);
    stages.push(
      stage(
        "settle",
        sent ? "Nano is final" : "Nanopayment not sent",
        sent
          ? "No per-call refund. Seller blocked on the next request."
          : "Seller failed — USDC stayed in the buyer Agent Wallet",
        "failed",
      ),
    );
    pushBuyer("settle", {
      kind: "sys",
      text: sent
        ? "Dust payment is final. Fail-closed for this seller going forward."
        : "Simulate seller failure: nanopayment was not sent. Seller received 0 USDC.",
    });
    recordSellerFailure();
    outcome = "FAILED";
  } else {
    recordSellerSuccess();
  }

  const receipt = buildReceipt({
    id: runId,
    buyerAgent: buyerTrust.agentId,
    sellerAgent: sellerTrust.agentId,
    service: service.id,
    amountUsd: service.priceUsd,
    rail: policy.rail,
    payment,
    verification,
    outcome,
  });

  stages.push(
    stage(
      "receipt",
      outcome === "SUCCESS" ? "Receipt issued" : "Receipt · failed",
      `${receipt.amount} USDC · ${policy.rail} · ${outcome}`,
      outcome === "SUCCESS" ? "complete" : "failed",
    ),
  );
  pushBuyer("receipt", {
    kind: "card",
    text: "Receipt",
    card: {
      Service: service.name,
      Amount: `${receipt.amount} USDC`,
      Rail: policy.rail === "DIRECT" ? "Nanopayment" : "Escrow",
      Network: "Arc",
      Status: outcome,
      Verification: receipt.verification.status,
      Tx: `${receipt.paymentTxHash.slice(0, 18)}…`,
      Mode: receipt.paymentMode,
    },
  });

  return done({
    service,
    trust: sellerTrust,
    policy,
    seller: sellerResponse,
    verification,
    payment,
    receipt,
    marketplace,
  });
}

export async function settlePurchase(runId: string, received: boolean): Promise<ExecuteResult> {
  const pending = pendingRuns.get(runId);
  if (!pending) throw new Error("No escrow is waiting on delivery for that transaction");
  const next = protectedSettlement({ verified: pending.verification.verified, received });
  if (next === "hold") throw new Error("Delivery confirmation is required");

  const stages = pending.stages.filter((s) => s.id !== "settle" && s.id !== "receipt");
  const buyerMessages = [...pending.buyerMessages];
  const sellerMessages = [...pending.sellerMessages];
  const timeline = [...pending.timeline];
  const pushBuyer = (phase: string, message: FeedMessage) => {
    buyerMessages.push(message);
    timeline.push({ phase, side: "buyer", message });
  };
  const pushSeller = (phase: string, message: FeedMessage) => {
    sellerMessages.push(message);
    timeline.push({ phase, side: "seller", message });
  };

  let payment = pending.payment;
  let outcome: Outcome;
  if (next === "capture") {
    payment = await captureEscrow(payment);
    stages.push(stage("settle", "Captured on Arc", "You confirmed receipt · USDC released to seller"));
    pushSeller("settle", { kind: "sys", text: "Capture · funds released to seller" });
    pushBuyer("settle", {
      kind: "inc",
      text: `${payment.amountUsd} USDC released from escrow to the seller Agent Wallet.`,
    });
    recordSellerSuccess();
    outcome = "SUCCESS";
  } else {
    payment = await voidEscrow(payment);
    stages.push(
      stage("settle", "Dispute raised", "Item not received · USDC refunded to buyer", "failed"),
    );
    pushSeller("settle", { kind: "sys", text: "Dispute raised · escrow returned to buyer" });
    pushBuyer("settle", {
      kind: "inc",
      text: `Dispute raised. ${payment.amountUsd} USDC refunded to your Agent Wallet. Seller was not paid.`,
    });
    outcome = "VOIDED";
  }

  const receipt = buildReceipt({
    id: pending.runId,
    buyerAgent: pending.buyerTrust.agentId,
    sellerAgent: pending.sellerTrust.agentId,
    service: pending.service.id,
    amountUsd: pending.service.priceUsd,
    rail: pending.policy.rail,
    payment,
    verification: pending.verification,
    outcome,
  });
  stages.push(
    stage(
      "receipt",
      outcome === "SUCCESS" ? "Receipt issued" : "Receipt · refunded",
      `${receipt.amount} USDC · ${pending.policy.rail} · ${outcome}`,
      outcome === "SUCCESS" ? "complete" : "failed",
    ),
  );
  pushBuyer("receipt", {
    kind: "card",
    text: "Receipt",
    card: {
      Service: pending.service.name,
      Amount: `${receipt.amount} USDC`,
      Rail: "Escrow",
      Network: "Arc",
      Status: outcome,
      Verification: receipt.verification.status,
      Tx: `${receipt.paymentTxHash.slice(0, 18)}…`,
      Mode: receipt.paymentMode,
    },
  });
  pendingRuns.delete(runId);

  return {
    runId: pending.runId,
    intent: pending.intent,
    service: pending.service,
    trust: pending.sellerTrust,
    policy: pending.policy,
    stages,
    seller: pending.seller,
    verification: pending.verification,
    payment,
    receipt,
    marketplace: pending.marketplace,
    buyerMessages,
    sellerMessages,
    timeline,
  };
}

export function health() {
  return {
    ok: true,
    product: "AgentARC · Agent commerce on Arc",
    tracks: ["Best Agentic Economy Application with Circle Agent Stack"],
    network: config.arc.network,
    chainId: config.arc.chainId,
    caip2: config.arc.caip2,
    paymentMode: paymentMode(),
    policy: config.policy,
    gas: gasRail(),
    circle: {
      agentWallets: Boolean(config.circle.apiKey && config.circle.entitySecret),
      nanopayments: true,
      gateway: config.arc.gatewayWallet,
      authCapture: Boolean(config.arc.escrow),
      marketplace: "https://api.circle.com/v2/x402/discovery/resources",
    },
    identity: {
      buyerAgentId: config.identity.buyerAgentId,
      sellerAgentId: config.identity.sellerAgentId,
      scan: config.identity.scanWeb,
    },
    seller: {
      origin: config.seller.origin,
      routes: ["/charts/ETH", "/charts/ETH/ohlc", "/research/ETH"],
    },
    services: ["/charts/ETH", "/charts/ETH/ohlc", "/research/ETH"],
  };
}

export function architecture() {
  return {
    title: "AgentARC · low-level design",
    tracks: [
      {
        name: "Best Agentic Economy Application with Circle Agent Stack",
        prize: "$1,667",
      },
    ],
    loop: [
      "Human prompt",
      "Buyer agent parses spend cap",
      "Discover Arc Chart Seller catalog",
      "ERC-8004 identity + failure ledger",
      "Policy: DIRECT nanopayment or PROTECTED escrow",
      "Pay on Arc USDC",
      "Independent verify",
      "Receipt",
    ],
    flow: [
      "Intent parsed from natural language + spend cap",
      "Discover the local Arc x402 seller (spot / OHLC). Circle Agent Marketplace is a price-band signal only",
      "Live ERC-8004 identity / reputation / x402 / failure signals (not a single score)",
      "Policy picks DIRECT nanopayment or PROTECTED AuthCapture",
      "DIRECT: HTTP GET seller → 402 PAYMENT-REQUIRED → EIP-3009 / adapter signature → retry with PAYMENT-SIGNATURE → Gateway or Arc USDC transfer",
      "PROTECTED: authorize USDC into operator escrow → GET /research/ETH → verify → buyer confirms receipt → capture or void",
      "Independent verification, then a receipt with Arc explorer link",
    ],
    boundaries: [
      { boundary: "Demo HTTP", owner: "cli/serve.ts", contract: "Buyer UI, orchestrator API, health, identities. Port 5180." },
      { boundary: "x402 seller", owner: "cli/seller.ts · src/seller/server.ts", contract: "Own process on 5181. Unpaid GET /charts/* returns HTTP 402 on eip155:5042002. Paid GET returns CoinGecko payload." },
      { boundary: "Intent", owner: "src/intent.ts · src/intent/capture.ts", contract: "Maps prompt + spend cap to financial-data, research, or commerce." },
      { boundary: "Discovery", owner: "src/seller/catalog.ts · src/marketplace.ts", contract: "Purchasable catalog is the local Arc seller. Circle /v2/x402/discovery/resources is median-only." },
      { boundary: "Trust", owner: "src/trust.ts", contract: "Live 8004scan #9638 / #6832. Fail closed if identity missing. Feedback is not a single score." },
      { boundary: "Policy", owner: "src/policy.ts", contract: "≤ $1 instant objective → DIRECT. ≥ $100 or lagged → PROTECTED. Overspend and ≥3 failures reject." },
      { boundary: "Nanopayments", owner: "src/seller/client.ts · src/circle/nanopayments.ts", contract: "Buyer signs the seller's PAYMENT-REQUIRED. Seller settles, then serves." },
      { boundary: "Escrow", owner: "src/circle/escrow.ts · contracts/AgentJobEscrow.sol", contract: "Authorize → verify → capture or void. No chargeback after capture." },
      { boundary: "Verification", owner: "src/verification.ts", contract: "Independent schema, timestamp, request correlation, price sanity — not seller-attested." },
    ],
    products: {
      Arc: "Settlement layer. USDC is native gas. Chain ID 5042002 testnet.",
      USDC: "Unit of account, gas token, and payment asset.",
      "Agent Stack": "Agent Wallets + Marketplace discovery (price band) + Nanopayments.",
      "Circle Wallets": "Developer-controlled EOAs for buyer, seller, operator on ARC-TESTNET.",
      Nanopayments: "x402 + Circle Gateway batched USDC (domain 26) against our Arc seller.",
      "Circle Contracts": "AgentJobEscrow authorize / capture / void on Arc.",
    },
    gas: gasRail(),
  };
}
