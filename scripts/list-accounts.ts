/** Show which DB file Pilot uses and account toggles (debug dashboard vs test script mismatch). */
import "../src/bootstrap-env.js";
import { loadConfig, projectRoot } from "../src/config.js";
import { getDb } from "../src/db/database.js";
import { listAccounts } from "../src/db/repositories.js";

getDb();
const cfg = loadConfig();
console.log("Project folder:", projectRoot());
console.log("Database file:", cfg.DATABASE_PATH);
console.log("");

const accounts = listAccounts();
if (accounts.length === 0) {
  console.log("No accounts in this database.");
  console.log("If the dashboard shows accounts, npm run dev may be using a different folder or DATABASE_PATH.");
  process.exit(1);
}

for (const a of accounts) {
  console.log(
    `#${a.id} ${a.nickname} | join_rain=${a.join_rain} | auto_cases=${a.auto_open_cases} | status=${a.status}`,
  );
}
