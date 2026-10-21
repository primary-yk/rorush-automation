/**
 * Quick checks when accounts won't save or tests see an empty DB.
 *   npm run doctor
 */
import { execSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import "../src/bootstrap-env.js";
import { ENV_FALLBACK_FILES } from "../src/bootstrap-env.js";
import {
  captchaApiKey,
  encryptionKeyStatus,
  loadConfig,
  projectRoot,
} from "../src/config.js";
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
    const hasLegacyCap = /^\s*CAPMONSTER_API_KEY\s*=/m.test(text);
    if (hasLegacyCap) {
      console.log(`${name} exists: yes (has CAPMONSTER_API_KEY — ignored; use CAPTCHA_API_KEY instead)`);
    } else {
      console.log(`${name} exists: yes`);
    }
    if (name === "nano.env" && hasCap) {
      console.log("  Tip: rename to .env when you can:  mv nano.env .env");
    }
  }
  console.log("Database file:", cfg.DATABASE_PATH);
  console.log("Database exists:", fs.existsSync(cfg.DATABASE_PATH) ? "yes" : "no (will be created on first write)");
  const enc = encryptionKeyStatus();
  console.log("ENCRYPTION_KEY:", enc.ok ? "set (32-byte key OK)" : enc.reason);
  const capKey = captchaApiKey(cfg);
  console.log(
    "Captcha API key (CAPTCHA_API_KEY):",
    capKey ? `set (${capKey.length} chars)` : "MISSING — rain join will fail",
  );
  console.log("Captcha provider:", cfg.CAPTCHA_PROVIDER ?? "2captcha");

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
    console.log("API reachable:", res.ok ? "yes" : "no");
    console.log("  Live encryptionConfigured:", body.encryptionConfigured);
    if (body.encryptionDetail) console.log("  Live detail:", body.encryptionDetail);
    console.log("  Live projectRoot:", body.projectRoot);
    console.log("  Accounts (live):", body.accountCount);
  } catch (e) {
    console.log("API reachable: NO — start `npm run dev`, then run doctor again in another tab");
    console.log(" ", e instanceof Error ? e.message : String(e));
    console.log(
      "  Discord can still reply from an OLD bot process — if /account add fails, kill all dev windows (WSL + Windows).",
    );
  }

  try {
    const ps = execSync('pgrep -af "tsx watch src/main|dist/main.js" 2>/dev/null || true', {
      encoding: "utf8",
    }).trim();
    if (ps) {
      const lines = ps.split("\n").filter(Boolean);
      console.log("\nRunning dev process(es):", lines.length);
      for (const line of lines.slice(0, 5)) console.log(" ", line.slice(0, 120));
      if (lines.length > 1) {
        console.log("  ^ More than one — stop extras or /account add may hit a bot without your .env");
      }
    }
  } catch {
    /* ignore */
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
    console.log(
      "• Balance/level blank: npm run test-stats -- --id 1  ·  rain history: npm run rain-joins  (use a 2nd terminal tab — dev keeps the 1st busy)",
    );
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
