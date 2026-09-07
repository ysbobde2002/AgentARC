/**
 * Provision buyer / seller / operator Agent Wallets on Arc Testnet.
 *
 * Requires CIRCLE_API_KEY + CIRCLE_ENTITY_SECRET in .env
 * Then fund the printed addresses at https://faucet.circle.com (Arc Testnet · USDC).
 */
import { randomUUID } from "node:crypto";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { initiateDeveloperControlledWalletsClient } from "@circle-fin/developer-controlled-wallets";
import { ROOT_DIR, config } from "../src/config.js";

function upsertEnv(file: string, updates: Record<string, string>) {
  let text = existsSync(file) ? readFileSync(file, "utf8") : "";
  for (const [key, value] of Object.entries(updates)) {
    if (!value) continue;
    const re = new RegExp(`^${key}=.*$`, "m");
    if (re.test(text)) text = text.replace(re, `${key}=${value}`);
    else text = `${text.trimEnd()}\n${key}=${value}\n`;
  }
  writeFileSync(file, text);
}

async function main() {
  if (!config.circle.apiKey || !config.circle.entitySecret) {
    console.error("Set CIRCLE_API_KEY and CIRCLE_ENTITY_SECRET in .env first.");
    console.error("https://developers.circle.com/wallets/dev-controlled/register-entity-secret");
    process.exit(1);
  }

  const client = initiateDeveloperControlledWalletsClient({
    apiKey: config.circle.apiKey,
    entitySecret: config.circle.entitySecret,
    baseUrl: config.circle.baseUrl,
  });

  let walletSetId = config.circle.walletSetId;
  if (!walletSetId) {
    const set = await client.createWalletSet({ name: "AgentARC", idempotencyKey: randomUUID() });
    walletSetId = set.data?.walletSet?.id || "";
    console.log("CIRCLE_WALLET_SET_ID=" + walletSetId);
  }

  const created = await client.createWallets({
    walletSetId,
    blockchains: ["ARC-TESTNET"],
    accountType: "EOA",
    count: 3,
    idempotencyKey: randomUUID(),
  });
  const wallets = created.data?.wallets ?? [];
  const labels = ["BUYER", "SELLER", "OPERATOR"] as const;
  const envFile = join(ROOT_DIR, ".env");
  const updates: Record<string, string> = { CIRCLE_WALLET_SET_ID: walletSetId };
  wallets.forEach((w, i) => {
    const label = labels[i] ?? `WALLET_${i}`;
    console.log(`${label}_WALLET_ID=${w.id}`);
    console.log(`${label}_WALLET_ADDRESS=${w.address}`);
    updates[`${label}_WALLET_ID`] = w.id || "";
    updates[`${label}_WALLET_ADDRESS`] = w.address || "";
  });
  upsertEnv(envFile, updates);
  console.log("\nWrote wallet IDs and addresses to .env");
  console.log("Fund each address with Arc Testnet USDC: https://faucet.circle.com");
  console.log("Then restart `npm run demo`.");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
