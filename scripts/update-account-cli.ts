/**
 * Update login email/password or clear a bad session for an existing account.
 *
 *   npm run update-account -- --id 1 --email you@gmail.com --password 'secret'
 */
import "../src/bootstrap-env.js";
import { getDb } from "../src/db/database.js";
import { getAccount, listAccounts, updateAccount } from "../src/db/repositories.js";
import { encryptField } from "../src/accounts/session-manager.js";
import { loadConfig, projectRoot } from "../src/config.js";

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(name);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

async function main() {
  const id = Number(arg("--id"));
  const email = arg("--email")?.trim();
  const password = arg("--password");
  const clearSession = process.argv.includes("--clear-session");

  if (!Number.isFinite(id) || id < 1) {
    console.error("Usage: npm run update-account -- --id 1 --email EMAIL --password 'PASS'");
    console.error("       npm run update-account -- --id 1 --clear-session");
    process.exit(1);
  }

  getDb();
  const cfg = loadConfig();
  console.log("Database:", cfg.DATABASE_PATH);
  console.log("Project:", projectRoot());

  const account = getAccount(id);
  if (!account) {
    console.error("Account #" + id + " not found. Existing:", listAccounts().map((a) => a.id).join(", "));
    process.exit(1);
  }

  const patch: Parameters<typeof updateAccount>[1] = {
    last_error: null,
    status: "idle",
  };

  if (clearSession || email || password) {
    patch.session_jwt_enc = null;
    patch.api_key_enc = null;
  }
  if (email) patch.username = email;
  if (password !== undefined) patch.password_enc = encryptField(password);

  if (!email && password === undefined && !clearSession) {
    console.error("Nothing to update — pass --email/--password or --clear-session");
    process.exit(1);
  }

  updateAccount(id, patch);
  console.log("Updated account #" + id, account.nickname);
  console.log("Run: npm run test-login -- --id", id);
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : String(e));
  process.exit(1);
});
