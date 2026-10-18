/**
 * Quick checks when accounts won't save or tests see an empty DB.
 *   npm run doctor
 */
import fs from "node:fs";
import "../src/bootstrap-env.js";
import { loadConfig, projectRoot } from "../src/config.js";
import { getDb } from "../src/db/database.js";
import { listAccounts } from "../src/db/repositories.js";
import { automationApiOrigin } from "../lib/automation-url.js";

async function main() {
  const root = projectRoot();
  const envPath = `${root}/.env`;
  const cfg = loadConfig();

  console.log("=== Rush Pilot doctor ===\n");
  console.log("Project folder:", root);
  console.log(".env exists:", fs.existsSync(envPath) ? "yes" : "NO — copy .env.example to .env");
  console.log("Database file:", cfg.DATABASE_PATH);
  console.log("Database exists:", fs.existsSync(cfg.DATABASE_PATH) ? "yes" : "no (will be created on first write)");
  console.log(
    "ENCRYPTION_KEY:",
    cfg.ENCRYPTION_KEY?.trim() ? "set (required to save passwords)" : "MISSING — accounts cannot be saved",
  );
  console.log("CAPMONSTER_API_KEY:", cfg.CAPMONSTER_API_KEY?.trim() ? "set" : "not set (rain captcha will fail)");

  getDb();
  const accounts = listAccounts();
  console.log("\nAccounts in this database:", accounts.length);
  for (const a of accounts) {
    console.log(`  #${a.id} ${a.nickname} join_rain=${a.join_rain}`);
  }

  const api = automationApiOrigin();
  console.log("\nAutomation API URL (Next/dashboard):", api);
  try {
    const res = await fetch(`${api}/health`, { signal: AbortSignal.timeout(5000) });
    const body = (await res.json()) as Record<string, unknown>;
    console.log("API reachable:", res.ok ? "yes" : "no", body);
  } catch (e) {
    console.log("API reachable: NO — run `npm run dev` and keep it open");
    console.log(" ", e instanceof Error ? e.message : String(e));
  }

  console.log("\n--- Tips ---");
  if (!cfg.ENCRYPTION_KEY?.trim()) {
    console.log("• Run: openssl rand -base64 32");
    console.log("• Put result in .env as ENCRYPTION_KEY=...");
    console.log("• Restart npm run dev");
  }
  if (accounts.length === 0) {
    console.log("• Add account at http://127.0.0.1:43123 (from Ubuntu, with npm run dev running)");
    console.log("• Or: npm run add-account -- --nick Main --email you@mail.com --password 'secret'");
  } else {
    console.log("• Login problems: npm run test-login  then  npm run update-account -- --id 1 --email … --password '…'");
  }
  console.log("• Find stray databases: find ~ -name 'rorush-automation.db' 2>/dev/null");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
