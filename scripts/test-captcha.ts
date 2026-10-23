/**
 * Verify CAPTCHA_API_KEY in .env (creates one hCaptcha task — small balance charge).
 *
 *   npm run test-captcha
 */
import "../src/bootstrap-env.js";
import { captchaApiKey, loadConfig, projectRoot } from "../src/config.js";
import {
  captchaKeyFingerprint,
  captchaTaskSummary,
  detectCaptchaProvider,
  resolveCaptchaProvider,
  solveCaptcha,
  verifyCaptchaKey,
} from "../src/captcha/solve.js";

async function main() {
  const cfg = loadConfig();
  console.log("Project:", projectRoot());
  const key = captchaApiKey(cfg);
  if (!key) {
    console.error("\nCAPTCHA_API_KEY is not set in .env");
    console.error("1. Sign up at https://nonecap.com (or 2captcha.com / capsolver.com)");
    console.error("2. Add to .env:");
    console.error("   CAPTCHA_API_KEY=nc_live_…   # NoneCap");
    console.error("   CAPTCHA_PROVIDER=nonecap");
    console.error("3. Restart the bot (pm2 restart … or npm run dev)");
    process.exit(1);
  }
  console.log("Captcha API key:", captchaKeyFingerprint(key));

  const verify = await verifyCaptchaKey(key);
  if (!verify.ok) {
    console.error("\nCaptcha provider rejected this API key:");
    console.error(" ", verify.errorDescription ?? verify.errorCode ?? "unknown error");
    console.error("\nFix .env — one line, no quotes:");
    console.error("  CAPTCHA_API_KEY=<key from dashboard>");
    console.error("  CAPTCHA_PROVIDER=nonecap   # or 2captcha / capsolver");
    process.exit(1);
  }
  if (verify.balanceUnit === "credits") {
    console.log("NoneCap credits:", verify.balance);
  } else {
    console.log("Captcha balance: $" + verify.balance!.toFixed(2));
  }

  const detected = await detectCaptchaProvider(key);
  const provider = await resolveCaptchaProvider(key);
  console.log(
    "Captcha provider:",
    provider,
    detected ? `(detected: ${detected})` : "(from CAPTCHA_PROVIDER)",
  );

  const task = captchaTaskSummary("hcaptcha");
  console.log("Task type:", task.taskType);
  console.log("Page URL:", task.websiteURL);
  console.log("Site key:", task.websiteKey);
  console.log(
    "Poll tuning:",
    `CAPTCHA_POLL_MS=${process.env.CAPTCHA_POLL_MS ?? "500 (default)"}`,
    `CAPTCHA_MAX_POLLS=${process.env.CAPTCHA_MAX_POLLS ?? "180 (default)"}`,
    `CAPTCHA_TASK_ATTEMPTS=${process.env.CAPTCHA_TASK_ATTEMPTS ?? "2 (default)"}`,
    `CAPTCHA_CANCEL_AFTER_MS=${process.env.CAPTCHA_CANCEL_AFTER_MS ?? "110000 (default)"}`,
  );

  console.log(
    "Requesting one hCaptcha token (often 10–90s; set CAPTCHA_VERBOSE=1 to see each poll)…",
  );
  const started = Date.now();
  const token = await solveCaptcha("hcaptcha");
  const sec = ((Date.now() - started) / 1000).toFixed(1);
  if (!token) {
    console.error("Provider returned no token — check balance and site key.");
    process.exit(1);
  }
  console.log("\nOK — captcha solve works. Token length:", token.length, `· ${sec}s`);
}

main().catch((e) => {
  console.error("\nFailed:", e instanceof Error ? e.message : String(e));
  console.error(
    "\nTips: CAPTCHA_VERBOSE=1 · confirm CAPTCHA_PROVIDER matches your key (nonecap / 2captcha).",
  );
  process.exit(1);
});
