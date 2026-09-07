# AgentARC — bounty submission

**Track:** Best Agentic Economy Application with Circle Agent Stack — $1,667

AgentARC is an agent-to-agent marketplace. A buyer agent holds a Circle Agent Wallet, discovers **our own x402 seller on Arc testnet** (ETH spot + OHLC charts), applies a policy engine to real signals, and pays in USDC. Dust calls settle as Nanopayments (HTTP 402). The research memo authorizes into escrow, verifies independently, then captures or voids.

Circle’s public x402 discovery index is mostly Base/Solana. Arc mentors confirmed there is no live public seller on Arc — so this repo runs one (`cli/seller.ts` on port 5181).

This submission is Track 1 only.

## What judges should click

1. Open the demo and run `Get me the current ETH price. Spend up to $0.05`.
2. `curl -i http://localhost:5181/charts/ETH` — unpaid is HTTP 402 on `eip155:5042002`.
3. Run `Get ETH chart details. Spend up to $0.05` — same 402 rail, OHLC candles.
4. Click **Architecture** at the bottom-left of the demo (or open `/architecture`) for the high-level design: workflow, policy engine, two rails.
5. Run `Buy the ETH research memo. Spend up to $150` — AuthCapture, then capture.
6. Repeat with **Simulate seller failure** — void.
7. Memo with max $50 — reject, no payment.

## Decision logic tied to real signals

| Signal | Source | Effect |
|---|---|---|
| Spend cap vs price | Parsed intent | Reject if overspend |
| ERC-8004 identity | Live 8004scan `#9638` / `#6832` | Fail closed if missing |
| x402 capability | 8004scan `x402_supported` + seller 402 | Seller can take nanopayments |
| Reputation / validations | ERC-8004 counts | Informational, never a single score |
| Recent failures | Persisted from prior runs | ≥3 failures reject |
| Delivery + objectivity | Service metadata | Lagged / subjective → escrow |
| Amount | `$NANO_MAX_USD` / `$PROTECT_MIN_USD` | ≤$1 nano, ≥$100 escrow |
| Marketplace median | Live Circle discovery | Price-band reason only — not the payTo |

## Circle products

| Product | Where |
|---|---|
| Agent Wallets | `src/circle/wallets.ts`, `scripts/setup-wallets.ts` |
| Agent Marketplace | `src/marketplace.ts` — median only |
| Nanopayments | `src/seller/server.ts` 402 + `src/circle/nanopayments.ts` |
| Circle Contracts | `contracts/AgentJobEscrow.sol` |

## Video script (90 seconds)

1. Title: AgentARC — Circle Agent Stack.
2. Architecture LLD: buyer :5180, seller :5181, two rails into Arc.
3. `curl` unpaid seller → 402.
4. ETH tick in UI → SUCCESS receipt.
5. ETH chart OHLC → SUCCESS.
6. Escrow memo + void on failure.
7. Close: GitHub + `npm run demo`.
