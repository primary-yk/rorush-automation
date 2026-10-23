/**
 * Show daily / weekly / monthly reward cases RoRush assigned to your account(s).
 *
 *   cd /opt/rorush-automation
 *   npm run show-daily-cases
 *   npm run show-daily-cases -- --nick fiery
 */
import "../src/bootstrap-env.js";
import { getDb } from "../src/db/database.js";
import { getAccount, listAccounts, listDueCases } from "../src/db/repositories.js";
import { ensureAuthenticated } from "../src/accounts/session-manager.js";
import { fetchRewardCaseSlots } from "../src/automation/reward-cases.js";
import { loadConfig } from "../src/config.js";
import { fetch } from "undici";

type CatalogCase = { caseId: string; caseName: string; caseLevel?: number };

async function fetchDailyCaseCatalog(): Promise<Map<string, CatalogCase>> {
  const cfg = loadConfig();
  const url = `${cfg.RORUSH_API_BASE}/api/v1/rewards/daily-cases`;
  const res = await fetch(url, {
    headers: { Accept: "application/json", "x-sec-rush": cfg.RORUSH_SEC_RUSH },
  });
  const map = new Map<string, CatalogCase>();
  if (!res.ok) return map;
  const rows = (await res.json()) as CatalogCase[];
  if (!Array.isArray(rows)) return map;
  for (const row of rows) {
    if (row?.caseId) map.set(row.caseId, row);
  }
  return map;
}

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(name);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

function fmtUnlock(iso: string | null, available: boolean): string {
  if (available) return "ready now";
  if (!iso) return "not ready";
  return `unlocks ~${iso.slice(0, 19).replace("T", " ")} UTC`;
}

async function main() {
  getDb();
  const nick = arg("--nick")?.trim().toLowerCase();
  let accounts = listAccounts();
  if (nick) {
    accounts = accounts.filter((a) => a.nickname.toLowerCase() === nick);
    if (accounts.length === 0) {
      console.error(`No account nicknamed "${arg("--nick")}".`);
      process.exit(1);
    }
  }

  const catalog = await fetchDailyCaseCatalog();
  console.log(
    "RoRush daily case ladder (all levels):",
    [...catalog.values()].map((c) => c.caseName).join(", ") || "(catalog unavailable)",
  );
  console.log("");

  for (const account of accounts) {
    console.log(`=== ${account.nickname} (#${account.id}) · level ${account.level ?? "?"} ===`);
    console.log(
      `Cases auto-open: ${Number(account.auto_open_cases) !== 0 ? "ON" : "OFF"} · paused: ${Number(account.automation_paused) !== 0 ? "yes" : "no"}`,
    );
    if (account.last_error) console.log(`Last error: ${account.last_error.slice(0, 200)}`);

    try {
      const { client } = await ensureAuthenticated(account.id);
      const slots = await fetchRewardCaseSlots(client);
      for (const s of slots) {
        const cat = s.caseId ? catalog.get(s.caseId) : undefined;
        const name = s.caseName ?? cat?.caseName ?? "(unknown case)";
        console.log(
          `  ${s.label}: ${name} · ${fmtUnlock(s.unlockAt, s.isAvailable)} · id ${s.caseId?.slice(0, 8) ?? "—"}…`,
        );
      }
      const due = listDueCases(Date.now()).filter((r) => r.account_id === account.id);
      if (due.length > 0) {
        console.log(`  Scheduled opens (${due.length}):`);
        for (const row of due) {
          console.log(`    · ${row.case_kind} ${row.case_id.slice(0, 8)}… at ${new Date(row.unlock_at_ms).toISOString().slice(0, 19)}Z`);
        }
      } else {
        console.log("  Scheduled opens: none due right now");
      }
    } catch (err) {
      console.log(`  ERROR: ${err instanceof Error ? err.message : String(err)}`);
    }
    console.log("");
  }
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : String(e));
  process.exit(1);
});
