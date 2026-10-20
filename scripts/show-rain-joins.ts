/**
 * Recent rain joins + saved pre-join balance (for post-rain limbo).
 * Safe while npm run dev is running — uses a read-only DB connection.
 *
 * Use a **second terminal tab** (dev keeps the first one busy).
 *
 *   npm run rain-joins
 *   npm run rain-joins -- --limit 10
 */
import "../src/bootstrap-env.js";
import { loadConfig, projectRoot } from "../src/config.js";
import { openReadonlyDb } from "../src/db/database.js";

function argVal(name: string): string | undefined {
  const i = process.argv.indexOf(name);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

const cfg = loadConfig();
const limit = Math.min(50, Math.max(1, Number(argVal("--limit") ?? 8) || 8));

let db: ReturnType<typeof openReadonlyDb>;
try {
  db = openReadonlyDb();
} catch {
  console.error("Database not found:", cfg.DATABASE_PATH);
  console.error("Start npm run dev once to create it, or check DATABASE_PATH in .env");
  process.exit(1);
}

console.log("Project:", projectRoot());
console.log("Database:", cfg.DATABASE_PATH);
console.log("(read-only — OK while dev is running; use another terminal tab)\n");

const nickById = new Map(
  (
    db.prepare("SELECT id, nickname FROM accounts").all() as Array<{ id: number; nickname: string }>
  ).map((a) => [a.id, a.nickname]),
);

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

const rows = db
  .prepare(
    `SELECT id, account_id, rain_id, amount, success, reason, balance_before_coins, created_at
     FROM rain_joins ORDER BY id DESC LIMIT ?`,
  )
  .all(limit) as Row[];

db.close();

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
