import { executeNanopayment } from "../payments.js";
import { config, paymentMode } from "../config.js";
import type { PaymentEvidence, SellerResponse } from "../types.js";

async function callSeller(
  path: string,
  opts: { paymentHeader?: string; fail?: boolean } = {},
) {
  const url = new URL(path, config.seller.origin);
  if (opts.fail) url.searchParams.set("fail", "1");
  const headers: Record<string, string> = { Accept: "application/json" };
  if (opts.paymentHeader) headers["PAYMENT-SIGNATURE"] = opts.paymentHeader;
  const res = await fetch(url, { headers, signal: AbortSignal.timeout(20_000) });
  const paymentRequired =
    res.headers.get("PAYMENT-REQUIRED") || res.headers.get("payment-required") || "";
  const body = (await res.json().catch(() => ({}))) as Record<string, unknown>;
  return { status: res.status, body, paymentRequired };
}

function asSeller(status: number, body: Record<string, unknown>): SellerResponse {
  return {
    httpStatus: status,
    body,
    requestId: String(body.requestId || ""),
    receivedAt: new Date().toISOString(),
  };
}

export async function paySellerX402(
  path: string,
  amountUsd: number,
  fail: boolean,
): Promise<{ payment: PaymentEvidence; seller: SellerResponse }> {
  if (fail) {
    const unpaid = await callSeller(path, { fail: true });
    return {
      payment: {
        mode: paymentMode(),
        rail: "DIRECT",
        scheme: "nanopayments",
        amountUsd: 0,
        note: "Seller failed — nanopayment was not sent",
      },
      seller: asSeller(unpaid.status === 402 ? 200 : unpaid.status, {
        ...unpaid.body,
        service: "market-data",
        asset: "ETH",
        error: "malformed",
        requestId: String(unpaid.body.requestId || "fail"),
      }),
    };
  }

  const unpaid = await callSeller(path);
  if (unpaid.status !== 402 || !unpaid.paymentRequired) {
    throw new Error(`Seller ${path} did not return HTTP 402 + PAYMENT-REQUIRED`);
  }
  const { evidence, paymentHeader } = await executeNanopayment(amountUsd, unpaid.paymentRequired);
  const paid = await callSeller(path, { paymentHeader });
  if (paid.status !== 200) {
    throw new Error(String(paid.body.error || `Seller returned HTTP ${paid.status}`));
  }
  return {
    payment: {
      ...evidence,
      mode: (paid.body.payment && typeof paid.body.payment === "object"
        ? (paid.body.payment as PaymentEvidence).mode
        : evidence.mode) || evidence.mode,
      rail: evidence.rail,
      scheme: evidence.scheme,
      amountUsd: evidence.amountUsd,
      settleTxHash:
        (paid.body.payment && typeof paid.body.payment === "object"
          ? (paid.body.payment as PaymentEvidence).settleTxHash
          : undefined) || evidence.settleTxHash,
      explorerUrl:
        (paid.body.payment && typeof paid.body.payment === "object"
          ? (paid.body.payment as PaymentEvidence).explorerUrl
          : undefined) || evidence.explorerUrl,
      note:
        (paid.body.payment && typeof paid.body.payment === "object"
          ? (paid.body.payment as PaymentEvidence).note
          : undefined) || evidence.note,
    },
    seller: asSeller(paid.status, paid.body),
  };
}

export async function fetchSellerResource(path: string, fail: boolean): Promise<SellerResponse> {
  const res = await callSeller(path, { fail });
  return asSeller(res.status, res.body);
}
