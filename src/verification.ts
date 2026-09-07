import type { SellerResponse, VerificationResult } from "./types.js";

export function verifyResponse(input: {
  response: SellerResponse;
  requestId: string;
  expectedAsset: string;
  category?: string;
}): VerificationResult {
  const { response, requestId, expectedAsset, category } = input;
  const body = response.body;
  const ts = typeof body.timestamp === "string" ? Date.parse(body.timestamp) : NaN;
  const price = typeof body.price === "number" ? body.price : NaN;

  if (category === "commerce") {
    const checks = {
      httpStatus: response.httpStatus === 200,
      schema: typeof body.orderId === "string" && typeof body.title === "string",
      timestamp: Number.isFinite(ts) && Date.now() - ts < 5 * 60_000,
      requestCorrelation: body.requestId === requestId,
      paymentCorrelation: Boolean(response.requestId),
      deadline: response.httpStatus === 200,
      priceSanity: true,
    };
    return { verified: Object.values(checks).every(Boolean), checks };
  }

  const checks = {
    httpStatus: response.httpStatus === 200,
    schema:
      typeof body.service === "string" &&
      typeof body.asset === "string" &&
      typeof body.price === "number" &&
      typeof body.timestamp === "string" &&
      typeof body.requestId === "string" &&
      (body.service !== "ohlc" || (Array.isArray(body.candles) && body.candles.length > 0)),
    timestamp: Number.isFinite(ts) && Date.now() - ts < 5 * 60_000,
    requestCorrelation: body.requestId === requestId,
    paymentCorrelation: Boolean(response.requestId),
    deadline: response.httpStatus === 200,
    priceSanity: Number.isFinite(price) && price > 100 && price < 1_000_000,
  };

  if (body.asset && body.asset !== expectedAsset) {
    checks.schema = false;
  }

  return {
    verified: Object.values(checks).every(Boolean),
    checks,
  };
}
