/**
 * Verify CAPMONSTER_API_KEY in .env (creates a task — small balance charge).
 *
 *   npm run test-captcha
 */
import "../src/bootstrap-env.js";
import { loadConfig, projectRoot } from "../src/config.js";
import {
  detectCaptchaProvider,
  resolveCaptchaProvider,
  solveCaptcha,
} from "../src/captcha/solve.js";

async function main() {
  const cfg = loadConfig();
  console.log("Project:", projectRoot());
  if (!cfg.CAPMONSTER_API_KEY) {
    console.error("\nCAPMONSTER_API_KEY is not set in .env");
    console.error("1. Sign up at https://capmonster.cloud");
    console.error("2. Add to ~/rush-pilot/.env:");
    console.error("   CAPMONSTER_API_KEY=your_key_here");
    console.error("3. Restart npm run dev (Ctrl+C, then npm run dev again)");
    process.exit(1);
  }
  console.log("CAPMONSTER_API_KEY: loaded (" + cfg.CAPMONSTER_API_KEY.length + " chars)");
  const detected = await detectCaptchaProvider(cfg.CAPMONSTER_API_KEY);
  const provider = await resolveCaptchaProvider(cfg.CAPMONSTER_API_KEY);
  console.log(
    "Captcha provider:",
    provider,
    detected ? `(detected via balance: ${detected})` : "(from CAPTCHA_PROVIDER or default)",
  );
  if (!detected && provider === "capmonster") {
    console.warn(
      "Could not verify key with getBalance — if solve fails, set CAPTCHA_PROVIDER=2captcha or capsolver",
    );
  }
  console.log("Requesting one hCaptcha token (may take 15–60s)…");
  const token = await solveCaptcha("hcaptcha");
  if (!token) {
    console.error("CapMonster returned no token — check balance and site key.");
    process.exit(1);
  }
  console.log("\nOK — captcha solve works. Token length:", token.length);
}

main().catch((e) => {
  console.error("\nFailed:", e instanceof Error ? e.message : String(e));
  process.exit(1);
});
