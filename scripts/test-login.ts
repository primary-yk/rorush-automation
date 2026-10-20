/**
 * Verify RoRush login for an account in the local DB (no rain join).
 *
 *   npm run test-login
 *   npm run test-login -- --id 1
 */
import "../src/bootstrap-env.js";
import { getDb } from "../src/db/database.js";
import { getAccount, listAccounts } from "../src/db/repositories.js";
import { decryptField } from "../src/accounts/session-manager.js";
import { RoRushHttpClient } from "../src/rorush/http-client.js";
import { loadConfig, projectRoot } from "../src/config.js";

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(name);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

function maskEmail(email: string): string {
  const [local, domain] = email.split("@");
  if (!domain) return "(not an email — use the same address you use on rorush.com)";
  const head = local.length <= 2 ? local[0] ?? "*" : `${local.slice(0, 2)}…`;
  return `${head}@${domain}`;
}

async function main() {
  getDb();
  const cfg = loadConfig();
  console.log("Project:", projectRoot());
  console.log("Database:", cfg.DATABASE_PATH);
  console.log("");

  const all = listAccounts();
  if (all.length === 0) {
    console.error("No accounts in database. Run npm run add-account first.");
    process.exit(1);
  }

  const id = Number(arg("--id") ?? all[0]!.id);
  const account = getAccount(id);
  if (!account) {
    console.error(`Account #${id} not found.`);
    console.error(
      "Accounts in this database:",
      all.map((a) => `#${a.id} ${a.nickname}`).join(", ") || "(none)",
    );
    console.error("Run: npm run accounts   or   npm run test-login   (no --id uses the first account)");
    process.exit(1);
  }

  console.log(`Account #${account.id} (${account.nickname})`);
  console.log("Stored login email:", account.username ? maskEmail(account.username) : "(missing)");
  console.log("Has password:", account.password_enc ? "yes" : "no");
  console.log("Has session JWT:", account.session_jwt_enc ? "yes" : "no");
  console.log("");

  if (account.session_jwt_enc) {
    try {
      const jwt = decryptField(account.session_jwt_enc);
      if (jwt) {
        const client = new RoRushHttpClient({ jwt }, account.proxy_url);
        const status = await client.authStatus();
        console.log("Session JWT auth/status:", status);
        if (status.authenticated) {
          console.log("\nOK — session token still valid. Rain can use this account.");
          return;
        }
        console.log("Session expired — will try email/password if set.\n");
      }
    } catch (e) {
      console.error(
        "Could not decrypt session (wrong ENCRYPTION_KEY?):",
        e instanceof Error ? e.message : String(e),
      );
      process.exit(1);
    }
  }

  if (!account.username || !account.password_enc) {
    console.error(
      "No email/password saved. Fix one of:\n" +
        "  • Dashboard → Accounts → re-enter email + password\n" +
        "  • npm run update-account -- --id " +
        id +
        " --email YOU@MAIL.com --password 'YOUR_PASS'\n" +
        "  • Paste Session JWT in dashboard if you sign in with Discord/Google",
    );
    process.exit(1);
  }

  let password: string;
  try {
    password = decryptField(account.password_enc)!;
  } catch (e) {
    console.error(
      "Could not decrypt password — ENCRYPTION_KEY in .env must match when the account was saved.",
    );
    process.exit(1);
  }

  console.log("Password length in DB:", password.length, "(0 = empty string was saved)");
  console.log("Calling RoRush login-email…");

  const client = new RoRushHttpClient({ jwt: "" }, account.proxy_url);
  try {
    const login = await client.loginEmail(account.username.trim(), password);
    if (login.twoFactorToken) {
      console.log("\nRoRush wants 2FA. Use Session JWT from browser DevTools instead.");
      process.exit(1);
    }
    if (login.userInfo?.jwtToken) {
      console.log("\nOK — email/password work. Level:", login.userInfo.level ?? "?");
      console.log("If test-rain still failed before, update the saved password:");
      console.log(`  npm run update-account -- --id ${id} --email '${account.username}' --password '…'`);
      return;
    }
    console.log("\nUnexpected response:", login);
    process.exit(1);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error("\nLogin failed:", msg);
    if (/credentials/i.test(msg)) {
      console.error(`
This message comes directly from RoRush — the email/password pair in your database is wrong.

Do this:
  1. Sign in at https://rorush.com with email + password (not Discord-only).
  2. If that works, update Rush Pilot:
       npm run update-account -- --id ${id} --email 'YOUR_EMAIL' --password 'YOUR_EXACT_PASSWORD'
     Use single quotes around the password so the shell does not eat special characters.
  3. Run: npm run test-login

If you only use Discord/Google on RoRush, paste a Session JWT in the dashboard instead.`);
    }
    process.exit(1);
  }
}

main();
