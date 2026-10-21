import {
  appendLog,
  getSettings,
  listAccounts,
  listDueCases,
  nextCaseUnlockMs,
  purgeDisallowedCaseSchedules,
  removeCaseSchedule,
  upsertCaseSchedule,
  updateAccount,
} from "../db/repositories.js";
import { AUTO_OPEN_CASE_KINDS, CASE_KIND, type CaseKind } from "../rorush/endpoints.js";
import { RoRushHub } from "../rorush/signalr-hub.js";
import { ensureAuthenticated } from "../accounts/session-manager.js";
import { accountEligibleForCases } from "../accounts/account-automation.js";
import { isIgnorableCaseError } from "./case-errors.js";
import { applyCaseOpenOutcome } from "./case-open-complete.js";
import { openRewardCaseOnHub, shouldScheduleRewardCase } from "./reward-cases.js";

function parseUnlockMs(value: unknown): number | null {
  if (typeof value === "number") return value;
  if (typeof value === "string") {
    const t = Date.parse(value);
    return Number.isNaN(t) ? null : t;
  }
  return null;
}

function isAutoOpenKind(kind: string): boolean {
  return (AUTO_OPEN_CASE_KINDS as readonly string[]).includes(kind);
}

const KIND_BY_INFO_KEY: Record<string, string> = {
  dailyCase: CASE_KIND.daily,
  weeklyCase: CASE_KIND.wseason,
  monthlyCase: CASE_KIND.mseason,
};

const LABEL_BY_KIND: Record<string, string> = {
  [CASE_KIND.daily]: "Daily",
  [CASE_KIND.wseason]: "Weekly",
  [CASE_KIND.mseason]: "Monthly",
};

export async function refreshCaseSchedulesForAccount(accountId: number): Promise<void> {
  const { account, client } = await ensureAuthenticated(accountId);
  if (!account.auto_open_cases) return;

  purgeDisallowedCaseSchedules(accountId, AUTO_OPEN_CASE_KINDS);

  const current = listAccounts().find((a) => a.id === accountId);
  if (current?.last_error && isIgnorableCaseError(current.last_error)) {
    updateAccount(accountId, { status: "idle", last_error: null });
  }

  const dailyInfo = await client.getDailyCasesInfo().catch(() => null);
  const now = Date.now();

  const scheduleCase = (caseId: string, kind: string, unlockAtMs: number, meta?: unknown) => {
    if (!isAutoOpenKind(kind)) return;
    upsertCaseSchedule({ accountId, caseId, caseKind: kind, unlockAtMs, meta });
  };

  if (dailyInfo && typeof dailyInfo === "object") {
    const d = dailyInfo as Record<string, unknown>;
    for (const [key, kind] of Object.entries(KIND_BY_INFO_KEY)) {
      const entry = d[key] as Record<string, unknown> | undefined;
      const caseId = entry?.caseId as string | undefined;
      if (!caseId) continue;
      const unlock = parseUnlockMs(entry?.unlockAt) ?? now;
      if (shouldScheduleRewardCase(entry)) {
        scheduleCase(caseId, kind, now, entry);
      } else if (entry?.isAvailable === false && unlock > now) {
        scheduleCase(caseId, kind, unlock, entry);
      }
    }
  }
}

export async function openDueCases(accountHubs: Map<number, RoRushHub>): Promise<number> {
  const settings = getSettings();
  if (settings.global_pause) return 0;

  const due = listDueCases(Date.now());
  let opened = 0;

  for (const row of due) {
    if (!isAutoOpenKind(row.case_kind)) {
      removeCaseSchedule(row.account_id, row.case_id);
      continue;
    }

    const account = listAccounts().find((a) => a.id === row.account_id);
    if (!account || !accountEligibleForCases(account)) {
      removeCaseSchedule(row.account_id, row.case_id);
      continue;
    }

    try {
      await ensureAuthenticated(row.account_id);
      let hub = accountHubs.get(row.account_id);
      if (!hub) {
        const { creds } = await ensureAuthenticated(row.account_id);
        hub = new RoRushHub(creds, {}, account.proxy_url);
        await hub.connect();
        await hub.ensureCaseSubscribed();
        accountHubs.set(row.account_id, hub);
      } else {
        await hub.ensureCaseSubscribed();
      }

      const outcome = await openRewardCaseOnHub(hub, {
        caseId: row.case_id,
        kind: row.case_kind as CaseKind,
      });

      applyCaseOpenOutcome({
        accountId: row.account_id,
        caseId: row.case_id,
        caseKind: row.case_kind,
        slotLabel: LABEL_BY_KIND[row.case_kind] ?? "Reward",
        outcome,
      });

      if (outcome.ok) opened++;
      removeCaseSchedule(row.account_id, row.case_id);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      updateAccount(row.account_id, { status: "error", last_error: message });
      appendLog({
        accountId: row.account_id,
        category: "case",
        message: "Case scheduler error",
        detail: message,
      });
    }
  }

  return opened;
}

export function msUntilNextCaseUnlock(): number {
  const next = nextCaseUnlockMs();
  if (!next) return 60_000;
  return Math.max(1_000, next - Date.now());
}

export async function refreshAllCaseSchedules(): Promise<void> {
  for (const account of listAccounts()) {
    if (!account.auto_open_cases) continue;
    try {
      await refreshCaseSchedulesForAccount(account.id);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      appendLog({
        accountId: account.id,
        category: "case",
        message: "Failed to refresh case schedule",
        detail: message,
      });
    }
  }
}
