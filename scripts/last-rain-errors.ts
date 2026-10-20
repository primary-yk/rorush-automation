/**
 * Print recent rain-related log lines (why join failed).
 *   npm run last-rain-errors
 */
import "../src/bootstrap-env.js";
import { getDb } from "../src/db/database.js";
import { listLogs } from "../src/db/repositories.js";

async function main() {
  getDb();
  const logs = listLogs(400).filter(
    (l) =>
      l.category === "rain" &&
      /error|fail|timeout|captcha|wager/i.test(`${l.message} ${l.detail ?? ""}`),
  );
  if (logs.length === 0) {
    console.log("No rain errors in the last ~400 log lines.");
    return;
  }
  console.log(`Last ${Math.min(15, logs.length)} rain error(s) (newest first):\n`);
  for (const l of logs.slice(0, 15)) {
    console.log(`— ${l.created_at}`);
    console.log(`  ${l.message}`);
    if (l.detail) console.log(`  ${l.detail.replace(/\n/g, "\n  ")}`);
    console.log("");
  }
}

main();
