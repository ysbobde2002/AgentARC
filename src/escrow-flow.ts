/** AuthCapture next step after independent verification. */
export function protectedSettlement(input: {
  verified: boolean;
  received?: boolean;
}): "void" | "hold" | "capture" {
  if (!input.verified) return "void";
  if (input.received === undefined) return "hold";
  return input.received ? "capture" : "void";
}
