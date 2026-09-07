export type Rail = "DIRECT" | "PROTECTED";
export type Decision = "APPROVE" | "REJECT";
export type ProtectionLevel = "DIRECT" | "PROTECTED_SETTLEMENT";
export type Outcome = "SUCCESS" | "FAILED" | "REJECTED" | "VOIDED" | "HELD";
export type PaymentMode = "circle" | "adapter";

export type ServiceCategory = "financial-data" | "research" | "commerce";

export type Service = {
  id: string;
  name: string;
  category: ServiceCategory;
  endpoint: string;
  priceUsd: number;
  currency: "USDC";
  network: "Arc";
  sellerAgentId: string;
  delivery: "instant" | "lagged";
  objective: boolean;
};

export type Intent = {
  raw: string;
  serviceType: ServiceCategory | "unknown";
  asset: string;
  maxSpendUsd: number;
  currency: "USDC";
  channel: "digital" | "shopify";
};

export type TrustSignals = {
  agentId: string;
  name: string;
  identityVerified: boolean;
  reputationSignals: number;
  validationSignals: number;
  recentFailures: number;
  registry: string;
  source?: "erc-8004" | "adapter";
  scanUrl?: string;
  x402Supported?: boolean;
  chainId?: number;
};

export type PolicyResult = {
  decision: Decision;
  rail: Rail;
  protectionLevel: ProtectionLevel;
  reasons: string[];
};

export type StageStatus = "pending" | "complete" | "failed" | "skipped";

export type Stage = {
  id: string;
  label: string;
  status: StageStatus;
  detail: string;
  rail?: Rail;
};

export type VerificationResult = {
  verified: boolean;
  checks: {
    httpStatus: boolean;
    schema: boolean;
    timestamp: boolean;
    requestCorrelation: boolean;
    paymentCorrelation: boolean;
    deadline: boolean;
    priceSanity: boolean;
  };
};

export type PaymentEvidence = {
  mode: PaymentMode;
  rail: Rail;
  scheme: "nanopayments" | "auth-capture";
  amountUsd: number;
  jobId?: string;
  authorizeTxHash?: string;
  captureTxHash?: string;
  voidTxHash?: string;
  settleTxHash?: string;
  explorerUrl?: string;
  circleTransactionId?: string;
  note?: string;
  x402?: {
    network: string;
    scheme: string;
    payTo: string;
    amountAtomic: string;
  };
  gateway?: {
    domain: number;
    batched: boolean;
  };
};

export type Receipt = {
  id: string;
  buyerAgent: string;
  sellerAgent: string;
  service: string;
  amount: string;
  currency: "USDC";
  network: "Arc";
  rail: Rail;
  paymentMode: PaymentMode;
  paymentTxHash: string;
  captureTxHash?: string;
  voidTxHash?: string;
  verification: { status: "PASSED" | "FAILED" | "SKIPPED" };
  outcome: Outcome;
  createdAt: string;
  explorerUrl: string;
};

export type SellerResponse = {
  httpStatus: number;
  body: Record<string, unknown>;
  requestId: string;
  receivedAt: string;
};

export type ExecuteInput = {
  prompt: string;
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
    advertisedNetwork?: string | null;
    method?: string;
  };
};

export type MarketplaceSignal = {
  source: "live" | "unavailable";
  total: number;
  medianUsd: number | null;
  sample: number;
  deterministic: false;
  listings: Array<{ name: string; priceUsd: number | null; resource: string }>;
};

export type ExecuteResult = {
  runId: string;
  intent: Intent;
  service: Service | null;
  trust: TrustSignals | null;
  policy: PolicyResult;
  stages: Stage[];
  seller: SellerResponse | null;
  verification: VerificationResult | null;
  payment: PaymentEvidence | null;
  receipt: Receipt | null;
  marketplace: MarketplaceSignal | null;
  buyerMessages: FeedMessage[];
  sellerMessages: FeedMessage[];
  timeline: TimelineEvent[];
  awaitingDelivery?: boolean;
};

export type FeedMessage = {
  kind: "out" | "inc" | "sys" | "card";
  text: string;
  card?: Record<string, string>;
};

export type TimelineEvent = {
  phase: string;
  side: "buyer" | "seller";
  message: FeedMessage;
};
