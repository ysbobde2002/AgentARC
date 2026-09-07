/** AuthCapture next step after independent verification.
 *  void: seller failed or buyer did not receive the item (refund before capture).
 *  hold: wait for the buyer to confirm delivery.
 *  capture: buyer confirmed receipt; USDC is final for the seller.
 */
export function protectedSettlement(input: {
  verified: boolean;
  received?: boolean;
}): "void" | "hold" | "capture" {
  if (!input.verified) return "void";
  if (input.received === undefined) return "hold";
  return input.received ? "capture" : "void";
}
