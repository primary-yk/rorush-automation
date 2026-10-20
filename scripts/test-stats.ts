/**
 * Fetch RoRush balance + level the same way the dashboard does.
 *
 *   npm run test-stats -- --id 1
 *
 * Run in a second terminal while `npm run dev` is up, or alone (uses your .env + DB).
 */
import "../src/bootstrap-env.js";
import { getDb } from "../src/db/database.js";
import { getAccount, listAccounts, updateAccount } from "../src/db/repositories.js";
import { ensureAuthenticated } from "../src/accounts/session-manager.js";
import { parseBalanceCents, parseLevel } from "../src/rorush/balance-level.js";
import { loadConfig, projectRoot } from "../src/config.js";

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(name);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

function toDisplayCoins(raw: number): number {
  /** RoRush /user/balance returns cents for whole-coin amounts; small decimals are already coins. */
  if (Number.isInteger(raw) && Math.abs(raw) >= 100) return raw / 100;
  return raw;
}

async function main() {
  getDb();
  const cfg = loadConfig();
  console.log("Project:", projectRoot());
  console.log("Database:", cfg.DATABASE_PATH);
  console.log("");

  const all = listAccounts();
  if (all.length === 0) {
    console.error("No accounts in database.");
    process.exit(1);
  }

  const id = Number(arg("--id") ?? all[0]!.id);
  const account = getAccount(id);
  if (!account) {
    console.error("No account with id", id);
    process.exit(1);
  }

  console.log(`Account #${id} ${account.nickname} (${account.username ?? "session"})`);
  console.log("DB now: balance=", account.balance, "level=", account.level);
  console.log("");

  try {
    const { client } = await ensureAuthenticated(id);
    const [balanceRaw, levelRaw] = await Promise.all([client.getBalance("crypto"), client.getLevel()]);
    console.log("RoRush balance raw:", JSON.stringify(balanceRaw));
    console.log("RoRush level raw:", JSON.stringify(levelRaw));

    const cents = parseBalanceCents(balanceRaw);
    const level = parseLevel(levelRaw);
    const coins = cents != null ? toDisplayCoins(cents) : null;

    console.log("");
    console.log("Parsed → coins:", coins, "level:", level);

    if (coins != null || level != null) {
      updateAccount(id, {
        ...(coins != null ? { balance: coins } : {}),
        ...(level != null ? { level } : {}),
        status: "idle",
      });
      console.log("\nOK — wrote to database. Refresh the dashboard.");
    } else {
      console.error("\nCould not parse balance or level — paste the raw JSON above in support/issue.");
      process.exit(1);
    }
  } catch (err) {
    console.error("\nFailed:", err instanceof Error ? err.message : String(err));
    console.error("\nIf login works (`npm run test-login`) but this fails, keep `npm run dev` running and retry.");
    process.exit(1);
  }
}

main();
