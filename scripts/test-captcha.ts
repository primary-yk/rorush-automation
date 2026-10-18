/**
 * Verify CAPMONSTER_API_KEY in .env (creates a task — small balance charge).
 *
 *   npm run test-captcha
 */
import "../src/bootstrap-env.js";
import { loadConfig, projectRoot } from "../src/config.js";
import { solveCaptcha } from "../src/captcha/capmonster.js";

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
