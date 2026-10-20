/**
 * Verify CAPTCHA_API_KEY in .env (creates one hCaptcha task — small balance charge).
 *
 *   npm run test-captcha
 */
import "../src/bootstrap-env.js";
import { captchaApiKey, loadConfig, projectRoot } from "../src/config.js";
import {
  captchaKeyFingerprint,
  detectCaptchaProvider,
  resolveCaptchaProvider,
  solveCaptcha,
  verify2CaptchaKey,
} from "../src/captcha/solve.js";

async function main() {
  const cfg = loadConfig();
  console.log("Project:", projectRoot());
  const key = captchaApiKey(cfg);
  if (!key) {
    console.error("\nCAPTCHA_API_KEY is not set in .env");
    console.error("1. Sign up at https://2captcha.com (or capsolver.com)");
    console.error("2. Add to ~/rush-pilot/.env:");
    console.error("   CAPTCHA_API_KEY=your_key_here");
    console.error("   CAPTCHA_PROVIDER=2captcha");
    console.error("3. Restart npm run dev (Ctrl+C, then npm run dev again)");
    process.exit(1);
  }
  console.log("Captcha API key:", captchaKeyFingerprint(key));
  if (!/^[a-f0-9]{32}$/i.test(key)) {
    console.warn(
      "Warning: 2Captcha keys are usually 32 hex characters. Yours may be mistyped or include hidden characters.",
    );
  }

  const verify = await verify2CaptchaKey(key);
  if (!verify.ok) {
    console.error("\n2Captcha rejected this API key (getBalance failed):");
    console.error(" ", verify.errorDescription ?? verify.errorCode ?? "unknown error");
    console.error("\nFix ~/rush-pilot/.env — one line, no quotes, no spaces:");
    console.error("  CAPTCHA_API_KEY=<paste from 2captcha.com → API Key>");
    console.error("  CAPTCHA_PROVIDER=2captcha");
    console.error("\nRemove duplicate CAPTCHA_API_KEY or old CAPMONSTER lines if the wrong one wins.");
    console.error("Then: npm run test-captcha");
    process.exit(1);
  }
  console.log("2Captcha balance: $" + verify.balance!.toFixed(2));

  const detected = await detectCaptchaProvider(key);
  const provider = await resolveCaptchaProvider(key);
  console.log(
    "Captcha provider:",
    provider,
    detected ? `(detected via balance: ${detected})` : "(from CAPTCHA_PROVIDER)",
  );

  console.log(
    "Requesting one hCaptcha token (often 30–120s; set CAPTCHA_VERBOSE=1 to see wait progress)…",
  );
  const started = Date.now();
  const token = await solveCaptcha("hcaptcha");
  const sec = ((Date.now() - started) / 1000).toFixed(1);
  if (!token) {
    console.error("Provider returned no token — check balance and site key.");
    process.exit(1);
  }
  console.log("\nOK — captcha solve works. Token length:", token.length, `· ${sec}s`);
  if (Number(sec) > 75) {
    console.log(
      "\nNote: >75s is usually provider queue load, not Rush Pilot.",
      "Keep npm run dev running before rain so prewarm finishes during tip stage.",
    );
  }
}

main().catch((e) => {
  console.error("\nFailed:", e instanceof Error ? e.message : String(e));
  process.exit(1);
});
