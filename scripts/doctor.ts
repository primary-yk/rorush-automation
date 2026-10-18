/**
 * Quick checks when accounts won't save or tests see an empty DB.
 *   npm run doctor
 */
import fs from "node:fs";
import path from "node:path";
import "../src/bootstrap-env.js";
import { ENV_FALLBACK_FILES } from "../src/bootstrap-env.js";
import { captchaApiKey, loadConfig, projectRoot } from "../src/config.js";
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
  for (const name of ENV_FALLBACK_FILES) {
    const alt = path.join(root, name);
    if (!fs.existsSync(alt)) continue;
    const text = fs.readFileSync(alt, "utf8");
    const hasCap = /^\s*CAPMONSTER_API_KEY\s*=/m.test(text);
    console.log(
      `${name} exists:`,
      hasCap ? "yes (fallback — we load this if .env is missing the key)" : "yes",
    );
    if (hasCap && !cfg.CAPMONSTER_API_KEY) {
      console.log(
        `  ⚠ CAPMONSTER line is in ${name} but still not loaded — check for typos (CAPMONSTER_API_KEY=...)`,
      );
    }
    if (name === "nano.env" && hasCap) {
      console.log("  Tip: rename to .env when you can:  mv nano.env .env");
    }
  }
  console.log("Database file:", cfg.DATABASE_PATH);
  console.log("Database exists:", fs.existsSync(cfg.DATABASE_PATH) ? "yes" : "no (will be created on first write)");
  console.log(
    "ENCRYPTION_KEY:",
    cfg.ENCRYPTION_KEY?.trim() ? "set (required to save passwords)" : "MISSING — accounts cannot be saved",
  );
  const capKey = captchaApiKey(cfg);
  console.log(
    "Captcha API key (CAPTCHA_API_KEY or CAPMONSTER_API_KEY):",
    capKey ? `set (${capKey.length} chars)` : "MISSING — rain join will fail",
  );
  if (capKey && (cfg.CAPTCHA_PROVIDER === "auto" || cfg.CAPTCHA_PROVIDER === "capmonster")) {
    console.log(
      "  Note: RoRush rain = hCaptcha. CapMonster Cloud removed hCaptcha API — use 2Captcha + CAPTCHA_PROVIDER=2captcha",
    );
  }

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
  if (!capKey) {
    console.log(
      "• Rain captcha: CAPTCHA_API_KEY= (from 2captcha.com) + CAPTCHA_PROVIDER=2captcha, then npm run test-captcha",
    );
  }
  console.log("• Find stray databases: find ~ -name 'rorush-automation.db' 2>/dev/null");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
