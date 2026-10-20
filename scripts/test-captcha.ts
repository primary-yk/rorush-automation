/**
 * Verify CAPTCHA_API_KEY in .env (creates one hCaptcha task — small balance charge).
 *
 *   npm run test-captcha
 */
import "../src/bootstrap-env.js";
import { captchaApiKey, loadConfig, projectRoot } from "../src/config.js";
import {
  detectCaptchaProvider,
  resolveCaptchaProvider,
  solveCaptcha,
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
  console.log("Captcha API key: loaded (" + key.length + " chars)");
  const detected = await detectCaptchaProvider(key);
  const provider = await resolveCaptchaProvider(key);
  console.log(
    "Captcha provider:",
    provider,
    detected ? `(detected via balance: ${detected})` : "(from CAPTCHA_PROVIDER)",
  );
  console.log("Requesting one hCaptcha token (may take 15–60s)…");
  const token = await solveCaptcha("hcaptcha");
  if (!token) {
    console.error("Provider returned no token — check balance and site key.");
    process.exit(1);
  }
  console.log("\nOK — captcha solve works. Token length:", token.length);
}

main().catch((e) => {
  console.error("\nFailed:", e instanceof Error ? e.message : String(e));
  process.exit(1);
});
