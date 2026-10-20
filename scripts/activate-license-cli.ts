/**
 * Unlock Pilot + Discord relay without opening the dashboard.
 *
 *   npm run activate-license -- --key 'RP1....'
 */
import "../src/bootstrap-env.js";
import { getDb } from "../src/db/database.js";
import { activateLicense, getLicenseStatus } from "../src/license/service.js";

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(name);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

async function main() {
  getDb();
  const key = arg("--key")?.trim();
  if (!key) {
    console.error("Usage: npm run activate-license -- --key 'RP1....'");
    process.exit(1);
  }
  const status = activateLicense(key);
  if (!status.active) {
    console.error("License rejected:", status.message);
    process.exit(1);
  }
  console.log("OK — license active on this PC.");
  console.log("Plan:", status.plan, "· ID:", status.licenseId);
  console.log("\nNext: npm run dev");
  console.log("Then in Discord: /activate with the same key → your private thread.");
}

main();
