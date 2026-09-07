import { arcChain } from "./chain.js";
import { config } from "../config.js";

/**
 * Gas rail for agent transactions.
 *
 * On Arc, USDC is the native EVM gas token — Circle Paymaster is unnecessary
 * because there is no separate ETH/native asset to sponsor. On other EVM chains
 * the same agents would pay gas in USDC via Circle Paymaster (ERC-4337).
 */
export function gasRail() {
  const chain = arcChain(config.arc.network);
  return {
    chain: chain.name,
    paysGasIn: "USDC",
    product: "Arc native USDC gas",
    paymasterRequired: false,
    paymasterEquivalent: "Circle Paymaster (ERC-4337) on non-Arc EVM chains",
    note: "Agents never hold a volatile gas token on Arc. USDC pays for both the job and the transaction.",
  };
}
