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
  isAvailable: boolean;
  unlockAt: string | null;
};

export async function fetchRewardCaseSlots(client: RoRushHttpClient): Promise<RewardCaseSlotStatus[]> {
  const raw = await client.getDailyCasesInfo().catch(() => null);
  const d = raw && typeof raw === "object" ? (raw as Record<string, unknown>) : {};
  return (Object.keys(REWARD_CASE_SLOT_META) as RewardCaseSlot[]).map((slot) => {
    const meta = REWARD_CASE_SLOT_META[slot];
    const entry = d[meta.infoKey] as Record<string, unknown> | undefined;
    const caseId = typeof entry?.caseId === "string" ? entry.caseId : null;
    const unlockAt =
      typeof entry?.unlockAt === "string"
        ? entry.unlockAt
        : typeof entry?.unlockAt === "number"
          ? new Date(entry.unlockAt).toISOString()
          : null;
    const isAvailable = entry?.isAvailable !== false;
    return { slot, label: meta.label, caseId, isAvailable, unlockAt };
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
