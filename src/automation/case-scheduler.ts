import { v4 as uuid } from "uuid";
import {
  appendLog,
  getSettings,
  listAccounts,
  listDueCases,
  nextCaseUnlockMs,
  recordCaseOpen,
  removeCaseSchedule,
  upsertCaseSchedule,
  updateAccount,
} from "../db/repositories.js";
import { CASE_KIND } from "../rorush/endpoints.js";
import { RoRushHub } from "../rorush/signalr-hub.js";
import { ensureAuthenticated } from "../accounts/session-manager.js";

function parseUnlockMs(value: unknown): number | null {
  if (typeof value === "number") return value;
  if (typeof value === "string") {
    const t = Date.parse(value);
    return Number.isNaN(t) ? null : t;
  }
  return null;
}

export async function refreshCaseSchedulesForAccount(accountId: number): Promise<void> {
  const { account, client } = await ensureAuthenticated(accountId);
  if (!account.auto_open_cases) return;

  const [dailyInfo, energyInfo, seasonInfo] = await Promise.all([
    client.getDailyCasesInfo().catch(() => null),
    client.getEnergyCasesInfo().catch(() => null),
    client.getSeasonCasesCurrent().catch(() => null),
  ]);

  const now = Date.now();

  const scheduleCase = (caseId: string, kind: string, unlockAtMs: number, meta?: unknown) => {
    if (unlockAtMs <= now) {
      upsertCaseSchedule({ accountId, caseId, caseKind: kind, unlockAtMs: now, meta });
    } else {
      upsertCaseSchedule({ accountId, caseId, caseKind: kind, unlockAtMs, meta });
    }
  };

  if (dailyInfo && typeof dailyInfo === "object") {
    const d = dailyInfo as Record<string, unknown>;
    for (const [key, kind] of [
      ["dailyCase", CASE_KIND.daily],
      ["weeklyCase", CASE_KIND.wseason],
      ["monthlyCase", CASE_KIND.mseason],
    ] as const) {
      const entry = d[key] as Record<string, unknown> | undefined;
      const caseId = entry?.caseId as string | undefined;
      if (!caseId) continue;
      const unlock = parseUnlockMs(entry?.unlockAt) ?? now;
      if (entry?.isAvailable === false && unlock > now) {
        scheduleCase(caseId, kind, unlock, entry);
      } else {
        scheduleCase(caseId, kind, now, entry);
      }
    }
    const rankCases = d.rankCases as Array<Record<string, unknown>> | undefined;
    for (const rc of rankCases ?? []) {
      const caseId = rc.caseId as string | undefined;
      if (!caseId) continue;
      const unlock = parseUnlockMs(rc.unlockAt) ?? now;
      scheduleCase(caseId, CASE_KIND.season, unlock, rc);
    }
  }

  const energyCases = (energyInfo as { cases?: Array<Record<string, unknown>> })?.cases ?? [];
  for (const row of energyCases) {
    const caseId = (row.case as { caseId?: string })?.caseId;
    if (!caseId) continue;
    if (row.isOpened) continue;
    const unlock = parseUnlockMs(row.unlockAt) ?? now;
    if (row.isAvailable) {
      scheduleCase(caseId, CASE_KIND.energy, now, row);
    } else {
      scheduleCase(caseId, CASE_KIND.energy, unlock, row);
    }
  }

  if (seasonInfo && typeof seasonInfo === "object") {
    const cases = (seasonInfo as { cases?: Array<Record<string, unknown>> }).cases ?? [];
    for (const row of cases) {
      const caseId = (row.case as { caseId?: string })?.caseId ?? (row.caseId as string | undefined);
      if (!caseId) continue;
      const unlock = parseUnlockMs(row.unlockAt) ?? now;
      scheduleCase(caseId, CASE_KIND.season, unlock, row);
    }
  }
}

export async function openDueCases(accountHubs: Map<number, RoRushHub>): Promise<number> {
  const settings = getSettings();
  if (settings.global_pause) return 0;

  const due = listDueCases(Date.now());
  let opened = 0;

  for (const row of due) {
    const account = listAccounts().find((a) => a.id === row.account_id);
    if (!account?.auto_open_cases) {
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
        await hub.subscribeCaseUnboxing();
        accountHubs.set(row.account_id, hub);
      }

      const reqId = uuid();
      const resultPromise = new Promise<{ ok: boolean; reward: number; message: string }>(
        (resolve) => {
          const timeout = setTimeout(
            () => resolve({ ok: false, reward: 0, message: "Case open timed out" }),
            45_000,
          );
          const offOk = hub!.on("ReceivePrivateCaseUnboxingResult", (payload) => {
            clearTimeout(timeout);
            offOk();
            offFail();
            const p = payload as { result?: { betAmount?: number; roundResults?: Array<{ winAmount?: number }> } };
            const win =
              p.result?.roundResults?.reduce((s, r) => s + (r.winAmount ?? 0), 0) ?? 0;
            resolve({ ok: true, reward: win / 100, message: "Case opened" });
          });
          const offFail = hub!.on("ReceiveCaseUnboxingFailure", (payload) => {
            clearTimeout(timeout);
            offOk();
            offFail();
            resolve({
              ok: false,
              reward: 0,
              message: (payload as { message?: string }).message ?? "Case open failed",
            });
          });
        },
      );

      await hub.playCaseUnboxing({
        reqId,
        caseId: row.case_id,
        casesNumber: 1,
        currency: "CRYPTO",
        kind: row.case_kind,
        isFastSpin: true,
        rankId: null,
      });

      const outcome = await resultPromise;
      recordCaseOpen({
        accountId: row.account_id,
        caseId: row.case_id,
        caseKind: row.case_kind,
        rewardAmount: outcome.reward,
        success: outcome.ok,
        reason: outcome.message,
      });

      if (outcome.ok) {
        opened++;
        const acc = listAccounts().find((a) => a.id === row.account_id)!;
        updateAccount(row.account_id, {
          lifetime_cases: acc.lifetime_cases + outcome.reward,
          status: "idle",
          last_error: null,
        });
        appendLog({
          accountId: row.account_id,
          category: "cases",
          message: "Opened case",
          detail: `${row.case_id} (+${outcome.reward})`,
        });
      } else {
        updateAccount(row.account_id, { status: "error", last_error: outcome.message });
        appendLog({
          accountId: row.account_id,
          category: "cases",
          message: "Case open failed",
          detail: outcome.message,
        });
      }

      removeCaseSchedule(row.account_id, row.case_id);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      updateAccount(row.account_id, { status: "error", last_error: message });
      appendLog({
        accountId: row.account_id,
        category: "cases",
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
        category: "cases",
        message: "Failed to refresh case schedule",
        detail: message,
      });
    }
  }
}
