/**
 * Add a RoRush account without the dashboard (same DB as npm run dev).
 *
 *   npm run add-account -- --nick fiery --email you@gmail.com --password 'yourpass'
 */
import "../src/bootstrap-env.js";
import { getDb } from "../src/db/database.js";
import { insertAccount, listAccounts } from "../src/db/repositories.js";
import { encryptField } from "../src/accounts/session-manager.js";
import { loadConfig, projectRoot } from "../src/config.js";

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(name);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

async function main() {
  const nick = arg("--nick")?.trim();
  const email = arg("--email")?.trim();
  const password = arg("--password");

  if (!nick || !email || !password) {
    console.error("Usage: npm run add-account -- --nick NAME --email EMAIL --password 'PASS'");
    process.exit(1);
  }

  getDb();
  const cfg = loadConfig();
  console.log("Database:", cfg.DATABASE_PATH);
  console.log("Project:", projectRoot());

  try {
    const row = insertAccount({
      nickname: nick,
      username: email,
      password_enc: encryptField(password),
    });
    console.log("Saved account #" + row.id, row.nickname);
    console.log("Total accounts:", listAccounts().length);
    console.log("Restart npm run dev if it was already running (or it will pick up on next action).");
  } catch (e) {
    console.error("Failed:", e instanceof Error ? e.message : String(e));
    if (String(e).includes("ENCRYPTION_KEY")) {
      console.error("\nAdd ENCRYPTION_KEY to .env (openssl rand -base64 32)");
    }
    process.exit(1);
  }
}

main();
