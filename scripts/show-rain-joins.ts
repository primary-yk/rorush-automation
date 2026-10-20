/**
 * Recent rain joins + saved pre-join balance (for post-rain limbo).
 * No sqlite3 CLI needed — uses the same DB as npm run dev.
 *
 *   npm run rain-joins
 *   npm run rain-joins -- --limit 10
 */
import "../src/bootstrap-env.js";
import { loadConfig, projectRoot } from "../src/config.js";
import { getDb } from "../src/db/database.js";
import { listAccounts } from "../src/db/repositories.js";

function argVal(name: string): string | undefined {
  const i = process.argv.indexOf(name);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

getDb();
const cfg = loadConfig();
const limit = Math.min(50, Math.max(1, Number(argVal("--limit") ?? 8) || 8));

console.log("Project:", projectRoot());
console.log("Database:", cfg.DATABASE_PATH);
console.log("");

const nickById = new Map(listAccounts().map((a) => [a.id, a.nickname]));

type Row = {
  id: number;
  account_id: number;
  rain_id: string;
  amount: number | null;
  success: number;
  reason: string | null;
  balance_before_coins: number | null;
  created_at: string;
};

const rows = getDb()
  .prepare(
    `SELECT id, account_id, rain_id, amount, success, reason, balance_before_coins, created_at
     FROM rain_joins ORDER BY id DESC LIMIT ?`,
  )
  .all(limit) as Row[];

if (rows.length === 0) {
  console.log("No rain joins recorded yet — join a rain with npm run dev running.");
  process.exit(0);
}

console.log(`Last ${rows.length} rain join(s):\n`);
for (const r of rows) {
  const nick = nickById.get(r.account_id) ?? `#${r.account_id}`;
  const ok = r.success ? "OK" : "FAIL";
  const bal =
    r.balance_before_coins != null
      ? `${r.balance_before_coins.toFixed(2)} coins (saved for limbo math)`
      : r.success
        ? "(no snapshot — join was before balance-save update, or read failed)"
        : "—";
  console.log(`#${r.id} ${nick} · ${ok} · ${r.created_at}`);
  console.log(`   rain ${r.rain_id.slice(0, 8)}… · pool ${r.amount ?? "?"} · before join: ${bal}`);
  if (r.reason && !r.success) {
    console.log(`   reason: ${r.reason.slice(0, 120)}`);
  }
  console.log("");
}
