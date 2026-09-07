/**
 * Generate + register a Circle entity secret, then write CIRCLE_ENTITY_SECRET to .env.
 * Recovery file lands in ./recovery/ — keep it; Circle cannot restore the secret without it.
 */
import { randomBytes } from "node:crypto";
import { appendFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { registerEntitySecretCiphertext } from "@circle-fin/developer-controlled-wallets";
import { ROOT_DIR, config } from "../src/config.js";

function upsertEnv(file: string, key: string, value: string) {
  let text = existsSync(file) ? readFileSync(file, "utf8") : "";
  const re = new RegExp(`^${key}=.*$`, "m");
  if (re.test(text)) text = text.replace(re, `${key}=${value}`);
  else text = `${text.trimEnd()}\n${key}=${value}\n`;
  writeFileSync(file, text);
}

async function main() {
  const apiKey = config.circle.apiKey;
  if (!apiKey) {
    console.error("CIRCLE_API_KEY is missing from .env");
    process.exit(1);
  }
  if (config.circle.entitySecret) {
    console.log("CIRCLE_ENTITY_SECRET is already set. Skipping register.");
    return;
  }

  const entitySecret = randomBytes(32).toString("hex");
  const recoveryDir = join(ROOT_DIR, "recovery");
  mkdirSync(recoveryDir, { recursive: true });

  const response = await registerEntitySecretCiphertext({
    apiKey,
    entitySecret,
    recoveryFileDownloadPath: recoveryDir,
    baseUrl: config.circle.baseUrl,
  });

  upsertEnv(join(ROOT_DIR, ".env"), "CIRCLE_ENTITY_SECRET", entitySecret);
  const recoveryNote = join(recoveryDir, "README.txt");
  appendFileSync(
    recoveryNote,
    `Registered ${new Date().toISOString()}. Keep recovery_file_*.dat with the entity secret.\n`,
  );
  console.log("Entity secret registered and written to .env");
  console.log("Recovery file saved under ./recovery/");
  if (response?.data) console.log("Circle register: ok");
}

main().catch((err) => {
  const msg = err instanceof Error ? err.message : String(err);
  console.error("Register failed:", msg);
  process.exit(1);
});
