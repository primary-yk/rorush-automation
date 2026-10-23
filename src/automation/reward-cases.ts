import { v4 as uuid } from "uuid";
import { ensureAuthenticated } from "../accounts/session-manager.js";
import { CASE_KIND, SIGNALR, type CaseKind } from "../rorush/endpoints.js";
import type { RoRushHttpClient } from "../rorush/http-client.js";
import { parseCaseUnboxingPayload, type CaseWonItem } from "../rorush/case-unbox-parse.js";
import type { RoRushHub } from "../rorush/signalr-hub.js";
import type { HubRegistry } from "../worker/hub-registry.js";

export type RewardCaseSlot = "daily" | "weekly" | "monthly";

export const REWARD_CASE_SLOT_META: Record<
  RewardCaseSlot,
  { infoKey: "dailyCase" | "weeklyCase" | "monthlyCase"; kind: CaseKind; label: string }
> = {
  daily: { infoKey: "dailyCase", kind: CASE_KIND.daily, label: "Daily" },
  weekly: { infoKey: "weeklyCase", kind: CASE_KIND.wseason, label: "Weekly" },
  monthly: { infoKey: "monthlyCase", kind: CASE_KIND.mseason, label: "Monthly" },
};

export type RewardCaseSlotStatus = {
  slot: RewardCaseSlot;
  label: string;
  caseId: string | null;
  caseName: string | null;
  isAvailable: boolean;
  unlockAt: string | null;
  rankId: string | null;
};

/** RoRush sometimes wraps payloads in `{ data: … }` or nests case under `case`. */
export function normalizeDailyCasesInfoBody(raw: unknown): Record<string, unknown> {
  if (!raw || typeof raw !== "object") return {};
  const top = raw as Record<string, unknown>;
  if (top.data != null && typeof top.data === "object") {
    return top.data as Record<string, unknown>;
  }
  return top;
}

export function normalizeRewardCaseEntry(entry: unknown): Record<string, unknown> | undefined {
  if (!entry || typeof entry !== "object") return undefined;
  const e = entry as Record<string, unknown>;
  const nested =
    e.case != null && typeof e.case === "object" ? (e.case as Record<string, unknown>) : null;
  const caseId =
    typeof e.caseId === "string"
      ? e.caseId
      : nested && typeof nested.caseId === "string"
        ? nested.caseId
        : undefined;
  if (!caseId) return undefined;
  const caseName =
    typeof e.caseName === "string"
      ? e.caseName
      : nested && typeof nested.caseName === "string"
        ? nested.caseName
        : undefined;
  return {
    ...e,
    caseId,
    caseName,
    unlockAt: e.unlockAt ?? nested?.unlockAt,
    isAvailable: e.isAvailable ?? nested?.isAvailable,
    rankId: e.rankId ?? nested?.rankId,
  };
}

export async function fetchRewardCaseSlots(client: RoRushHttpClient): Promise<RewardCaseSlotStatus[]> {
  const raw = await client.getDailyCasesInfo().catch(() => null);
  const d = normalizeDailyCasesInfoBody(raw);
  return (Object.keys(REWARD_CASE_SLOT_META) as RewardCaseSlot[]).map((slot) => {
    const meta = REWARD_CASE_SLOT_META[slot];
    const entry = normalizeRewardCaseEntry(d[meta.infoKey]);
    const caseId = typeof entry?.caseId === "string" ? entry.caseId : null;
    const caseName = typeof entry?.caseName === "string" ? entry.caseName : null;
    const unlockAt =
      typeof entry?.unlockAt === "string"
        ? entry.unlockAt
        : typeof entry?.unlockAt === "number"
          ? new Date(entry.unlockAt).toISOString()
          : null;
    const isAvailable = entry?.isAvailable !== false;
    const rankId = typeof entry?.rankId === "string" ? entry.rankId : null;
    return { slot, label: meta.label, caseId, caseName, isAvailable, unlockAt, rankId };
  });
}

export type OpenRewardCaseOutcome = {
  ok: boolean;
  slot: RewardCaseSlot;
  caseId: string;
  rewardCoins: number;
  items: CaseWonItem[];
  message: string;
};

function parseUnlockMs(value: unknown): number | null {
  if (typeof value === "number") return value;
  if (typeof value === "string") {
    const t = Date.parse(value);
    return Number.isNaN(t) ? null : t;
  }
  return null;
}

export function shouldScheduleRewardCase(entry: Record<string, unknown> | undefined): boolean {
  if (!entry?.caseId) return false;
  const now = Date.now();
  const unlock = parseUnlockMs(entry.unlockAt) ?? now;
  if (entry.isAvailable === true) return true;
  if (entry.isAvailable === false && unlock <= now) return true;
  if (entry.isAvailable == null && unlock <= now) return true;
  return false;
}

export async function openRewardCaseOnHub(
  hub: RoRushHub,
  input: { caseId: string; kind: CaseKind; rankId?: string | null },
): Promise<{ ok: boolean; rewardCoins: number; items: CaseWonItem[]; message: string }> {
  await hub.ensureCaseSubscribed();
  const reqId = uuid();

  const resultPromise = new Promise<{
    ok: boolean;
    rewardCoins: number;
    items: CaseWonItem[];
    message: string;
  }>((resolve) => {
    const timeout = setTimeout(
      () => resolve({ ok: false, rewardCoins: 0, items: [], message: "Case open timed out" }),
      60_000,
    );
    const finish = (outcome: {
      ok: boolean;
      rewardCoins: number;
      items: CaseWonItem[];
      message: string;
    }) => {
      clearTimeout(timeout);
      offOk();
      offFail();
      resolve(outcome);
    };

    const offOk = hub.on(SIGNALR.caseUnboxing.receiveResult, (payload) => {
      const parsed = parseCaseUnboxingPayload(payload, reqId);
      if (!parsed.matched) return;
      finish({
        ok: true,
        rewardCoins: parsed.totalWinCoins,
        items: parsed.items,
        message: "Case opened",
      });
    });
    const offFail = hub.on(SIGNALR.caseUnboxing.receiveFailure, (payload) => {
      const p = payload as { reqId?: string; message?: string };
      if (p.reqId && p.reqId !== reqId) return;
      finish({
        ok: false,
        rewardCoins: 0,
        items: [],
        message: p.message ?? "Case open failed",
      });
    });
  });

  await hub.playCaseUnboxing({
    reqId,
    caseId: input.caseId,
    casesNumber: 1,
    currency: "CRYPTO",
    kind: input.kind,
    isFastSpin: true,
    rankId: input.rankId ?? null,
  });

  return resultPromise;
}

export async function openRewardCaseForAccount(input: {
  accountId: number;
  slot: RewardCaseSlot;
  hubs: HubRegistry;
}): Promise<OpenRewardCaseOutcome> {
  const meta = REWARD_CASE_SLOT_META[input.slot];
  const { client } = await ensureAuthenticated(input.accountId);
  const slots = await fetchRewardCaseSlots(client);
  const slotRow = slots.find((s) => s.slot === input.slot);
  if (!slotRow?.caseId) {
    throw new Error(`${meta.label} case is not configured on RoRush for this account.`);
  }
  if (!slotRow.isAvailable) {
    const when = slotRow.unlockAt?.slice(0, 19) ?? "later";
    throw new Error(`${meta.label} case is not available yet (unlocks ~${when} UTC).`);
  }

  const hub = await input.hubs.ensure(input.accountId, { cases: true });

  const outcome = await openRewardCaseOnHub(hub, {
    caseId: slotRow.caseId,
    kind: meta.kind,
    rankId: slotRow.rankId,
  });

  return {
    ok: outcome.ok,
    slot: input.slot,
    caseId: slotRow.caseId,
    rewardCoins: outcome.rewardCoins,
    items: outcome.items,
    message: outcome.message,
  };
}
