/**
 * Test limbo + rain captcha without needing much balance.
 *
 *   npm run test-limbo              # dry-run: auth + hub; bet only if balance ≥ 0.01
 *   npm run test-limbo -- --probe   # no bet — hub + session only
 *   npm run test-limbo -- --id 2
 *   npm run test-limbo -- --with-captcha   # also run one hCaptcha solve (2Captcha charge)
 */
import "../src/bootstrap-env.js";
import { getDb } from "../src/db/database.js";
import { getAccount, listAccounts } from "../src/db/repositories.js";
import { ensureAuthenticated } from "../src/accounts/session-manager.js";
import { runTestLimboBet, parseLimboResult } from "../src/automation/rain-join.js";
import { HubRegistry } from "../src/worker/hub-registry.js";
import { parseBalanceCents } from "../src/rorush/balance-level.js";
import { LIMBO_MIN_MULTIPLIER, loadConfig, projectRoot } from "../src/config.js";
import { captchaApiKey } from "../src/config.js";
import { solveCaptcha, verify2CaptchaKey, captchaKeyFingerprint } from "../src/captcha/solve.js";

function arg(name: string): boolean {
  return process.argv.includes(name);
}

function argVal(name: string): string | undefined {
  const i = process.argv.indexOf(name);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

function displayCoins(raw: number): number {
  if (Number.isInteger(raw) && Math.abs(raw) >= 100) return raw / 100;
  return raw;
}

function isNoBalanceError(msg: string): boolean {
  return /limbo skipped|need at least 0\.01|insufficient|not enough|balance/i.test(msg);
}

async function testCaptchaOptional(): Promise<void> {
  const key = captchaApiKey();
  if (!key) {
    console.log("\n[rain captcha] SKIP — CAPTCHA_API_KEY not set");
    return;
  }
  console.log("\n[rain captcha] key", captchaKeyFingerprint(key));
  const v = await verify2CaptchaKey(key);
  if (!v.ok) {
    console.error("[rain captcha] FAIL —", v.errorDescription ?? v.errorCode);
    process.exit(1);
  }
  console.log("[rain captcha] balance $" + v.balance!.toFixed(2));
  console.log("[rain captcha] solving one hCaptcha (same as rain join)…");
  const t0 = Date.now();
  const token = await solveCaptcha("hcaptcha");
  const sec = ((Date.now() - t0) / 1000).toFixed(1);
  if (!token) {
    console.error("[rain captcha] FAIL — no token");
    process.exit(1);
  }
  console.log(`[rain captcha] OK — token length ${token.length} · ${sec}s`);
}

async function main() {
  getDb();
  const cfg = loadConfig();
  const probe = arg("--probe");
  const withCaptcha = arg("--with-captcha");

  console.log("=== Rush Pilot limbo / rain captcha test ===\n");
  console.log("Project:", projectRoot());
  console.log("Limbo min multiplier:", LIMBO_MIN_MULTIPLIER);

  const sampleHit = parseLimboResult({ isWin: true, multiplier: 245 });
  const sampleMiss = parseLimboResult({ isWin: false, multiplier: 112 });
  console.log(
    "Limbo result parser:",
    sampleHit.hit ? "hit" : "miss",
    "@",
    sampleHit.crashMultiplier?.toFixed(2),
    "/ miss crash",
    sampleMiss.crashMultiplier?.toFixed(2) + "×",
  );

  const all = listAccounts();
  if (all.length === 0) {
    console.error("\nNo accounts — add one on the dashboard or npm run add-account");
    process.exit(1);
  }

  const id = Number(argVal("--id") ?? all[0]!.id);
  const account = getAccount(id);
  if (!account) {
    console.error("Account #" + id + " not found");
    process.exit(1);
  }

  console.log(`\nAccount #${id} ${account.nickname} · limbo_wager=${account.limbo_wager_enabled}`);

  const { client } = await ensureAuthenticated(id);
  const rawBal = await client.getBalance();
  const cents = parseBalanceCents(rawBal);
  const balance = cents != null ? displayCoins(cents) : 0;
  console.log("Balance:", balance.toFixed(2), "coins");

  const hubs = new HubRegistry();
  const hub = await hubs.ensure(id, { rain: true, cases: true });
  console.log("SignalR hub: connected (rain + cases subscribed)");

  if (probe) {
    console.log("\nOK — probe mode (no limbo bet). Session + hub are good.");
    console.log("Post-rain limbo runs when balance ≥ 0.01 from rain payout.");
    await hubs.disconnectAll();
    if (withCaptcha) await testCaptchaOptional();
    return;
  }

  if (balance < 0.01) {
    console.log("\nDry-run: balance too low for a real 0.01 bet — skipping PlayLimboGame.");
    console.log("OK — limbo path would skip until you earn coins from rain (expected with $0).");
    await hubs.disconnectAll();
    if (withCaptcha) await testCaptchaOptional();
    return;
  }

  console.log("\nTrying test limbo 0.01 coins @", account.limbo_multiplier, "× …");
  try {
    const result = await runTestLimboBet({
      accountId: id,
      betCoins: 0.01,
      multiplier: Math.max(LIMBO_MIN_MULTIPLIER, account.limbo_multiplier),
      hubs,
    });
    console.log("\nOK — limbo bet placed. Hit:", result.hit, "· bet", result.betCoins, "coins");
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    if (isNoBalanceError(msg)) {
      console.log("\nOK — limbo pipeline reached RoRush; bet blocked (no balance). Message:", msg);
    } else {
      console.error("\nFAIL —", msg);
      process.exit(1);
    }
  } finally {
    await hubs.disconnectAll();
  }

  if (withCaptcha) await testCaptchaOptional();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
