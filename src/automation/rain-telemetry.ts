import type { RainState } from "../rorush/types.js";
import {
  rainJoinOpensInMs,
  rainJoinStageBounds,
  rainJoinWindowOpen,
  rainJoinWindowRemainingMs,
} from "./rain-join.js";

export type RainAccountPhase =
  | "idle"
  | "solving"
  | "ready"
  | "joining"
  | "joined"
  | "failed"
  | "skipped";

export type RainAccountStatus = {
  accountId: number;
  nickname: string;
  phase: RainAccountPhase;
  detail?: string;
};

export type RainTelemetryRow = {
  rainId: string;
  poolCoins?: number;
  createdAtMs: number;
  captchaReadyAtMs?: number;
  captchaSolveSec?: number;
  joinWindowStartMs?: number;
  joinWindowEndMs?: number;
  joinAttempts: number;
  joinedNicknames: string[];
  pendingNicknames: string[];
  lastErrors: string[];
  accountStatuses: RainAccountStatus[];
  finishedAtMs?: number;
};

const active = new Map<string, RainTelemetryRow>();
let lastFinished: RainTelemetryRow | null = null;

function row(rainId: string): RainTelemetryRow {
  let r = active.get(rainId);
  if (!r) {
    r = {
      rainId,
      createdAtMs: Date.now(),
      joinAttempts: 0,
      joinedNicknames: [],
      pendingNicknames: [],
      lastErrors: [],
      accountStatuses: [],
    };
    active.set(rainId, r);
  }
  return r;
}

function upsertAccountStatus(rainId: string, status: RainAccountStatus): void {
  const r = row(rainId);
  const idx = r.accountStatuses.findIndex((s) => s.accountId === status.accountId);
  if (idx >= 0) {
    r.accountStatuses[idx] = { ...r.accountStatuses[idx], ...status };
  } else {
    r.accountStatuses.push(status);
  }
}

export function rainTelemetryOnCreated(rain: RainState): void {
  const r = row(rain.rainId);
  r.poolCoins = rain.amount ?? r.poolCoins;
  r.createdAtMs = Date.now();
}

export function rainTelemetryUpdateWindow(rain: RainState, now = Date.now()): void {
  const bounds = rainJoinStageBounds(rain, now);
  if (!bounds) return;
  const r = row(rain.rainId);
  r.joinWindowStartMs = bounds.joinStart;
  r.joinWindowEndMs = bounds.joinEnd;
  r.poolCoins = rain.amount ?? r.poolCoins;
}

export function rainTelemetrySyncJoinAccounts(
  rainId: string,
  accounts: Array<{ id: number; nickname: string }>,
): void {
  for (const a of accounts) {
    upsertAccountStatus(rainId, {
      accountId: a.id,
      nickname: a.nickname,
      phase: "idle",
    });
  }
}

export function rainTelemetryAccountPhase(
  rainId: string,
  accountId: number,
  nickname: string,
  phase: RainAccountPhase,
  detail?: string,
): void {
  upsertAccountStatus(rainId, { accountId, nickname, phase, detail });
}

export function rainTelemetryCaptchaReady(rainId: string, solveSec: number): void {
  const r = row(rainId);
  r.captchaReadyAtMs = Date.now();
  r.captchaSolveSec = solveSec;
}

export function rainTelemetryAccountCaptchaReady(
  rainId: string,
  accountId: number,
  nickname: string,
  solveSec: number,
): void {
  rainTelemetryAccountPhase(rainId, accountId, nickname, "ready", `${solveSec.toFixed(0)}s`);
}

export function rainTelemetryAccountCaptchaSolving(
  rainId: string,
  accountId: number,
  nickname: string,
): void {
  rainTelemetryAccountPhase(rainId, accountId, nickname, "solving");
}

export function rainTelemetryJoinAttempt(rainId: string, pendingNicknames: string[]): void {
  const r = row(rainId);
  r.joinAttempts += 1;
  r.pendingNicknames = [...pendingNicknames];
}

export function rainTelemetryAccountJoined(rainId: string, nickname: string): void {
  const r = row(rainId);
  if (!r.joinedNicknames.includes(nickname)) r.joinedNicknames.push(nickname);
  r.pendingNicknames = r.pendingNicknames.filter((n) => n !== nickname);
  const st = r.accountStatuses.find((s) => s.nickname === nickname);
  if (st) {
    st.phase = "joined";
    st.detail = undefined;
  }
}

export function rainTelemetryAccountFailed(rainId: string, nickname: string, reason: string): void {
  const r = row(rainId);
  const line = `${nickname}: ${reason.slice(0, 100)}`;
  r.lastErrors = [line, ...r.lastErrors].slice(0, 5);
  const st = r.accountStatuses.find((s) => s.nickname === nickname);
  if (st) {
    st.phase = "failed";
    st.detail = reason.slice(0, 80);
  }
}

export function rainTelemetryAccountSkipped(
  rainId: string,
  accountId: number,
  nickname: string,
  reason: string,
): void {
  rainTelemetryAccountPhase(rainId, accountId, nickname, "skipped", reason);
}

export function rainTelemetryFinish(rainId: string): RainTelemetryRow | null {
  const r = active.get(rainId);
  if (!r) return null;
  r.finishedAtMs = Date.now();
  lastFinished = { ...r, accountStatuses: [...r.accountStatuses] };
  active.delete(rainId);
  return lastFinished;
}

export function rainTelemetryGet(rainId: string): RainTelemetryRow | undefined {
  return active.get(rainId);
}

export function rainTelemetryActiveRainId(): string | null {
  const keys = [...active.keys()];
  return keys.length ? keys[keys.length - 1]! : null;
}

export function rainTelemetryLastFinished(): RainTelemetryRow | null {
  return lastFinished;
}

export function formatRainJoinSummary(r: RainTelemetryRow): string {
  const joined = r.joinedNicknames.length;
  const pending = r.pendingNicknames.length;
  const target = joined + pending || joined || 1;
  const cap =
    r.captchaSolveSec != null ? `${r.captchaSolveSec.toFixed(0)}s captcha` : "captcha pending";
  const window =
    r.joinWindowEndMs != null
      ? r.finishedAtMs != null && r.finishedAtMs > r.joinWindowEndMs
        ? "window closed before finish"
        : "window used"
      : "window unknown";
  const who =
    r.joinedNicknames.length > 0
      ? r.joinedNicknames.join(", ")
      : pending > 0
        ? `none yet (tried: ${r.pendingNicknames.join(", ")})`
        : "no accounts";
  return `joined ${joined}/${target} · ${cap} · ${window} · ${who}`;
}

export type RainLiveStatus = {
  active: boolean;
  rainId: string | null;
  poolCoins: number | null;
  joinWindowOpen: boolean;
  joinOpensInSec: number;
  joinWindowRemainingSec: number;
  joinWindowTotalSec: number;
  captchaReady: boolean;
  captchaSolveSec: number | null;
  captchaWaitingSec: number | null;
  joinAttempts: number;
  joinedNicknames: string[];
  accountStatuses: RainAccountStatus[];
  listenerConnected: boolean;
  telemetry: RainTelemetryRow | null;
  lastSummary: string | null;
};

export function buildRainLiveStatus(input: {
  rain: RainState | null;
  listenerConnected: boolean;
}): RainLiveStatus {
  const rain = input.rain;
  const rainId = rain?.rainId ?? null;
  const tel = rainId ? rainTelemetryGet(rainId) : null;
  const now = Date.now();
  const joinOpen = rain ? rainJoinWindowOpen(rain, now) : false;
  const remaining = rain ? Math.round(rainJoinWindowRemainingMs(rain, now) / 1000) : 0;
  const opensIn = rain ? Math.round(rainJoinOpensInMs(rain, now) / 1000) : 0;
  const bounds = rain ? rainJoinStageBounds(rain, now) : null;
  const joinTotalSec =
    bounds != null ? Math.max(0, Math.round((bounds.joinEnd - bounds.joinStart) / 1000)) : 0;

  let captchaWaitingSec: number | null = null;
  if (tel && !tel.captchaReadyAtMs) {
    captchaWaitingSec = Math.round((now - tel.createdAtMs) / 1000);
  }

  const readyCount =
    tel?.accountStatuses.filter((s) => s.phase === "ready" || s.phase === "joined").length ?? 0;
  const captchaReady =
    !!tel?.captchaReadyAtMs ||
    (tel != null &&
      tel.accountStatuses.length > 0 &&
      readyCount >= tel.accountStatuses.filter((s) => s.phase !== "skipped").length);

  const last = rainTelemetryLastFinished();

  return {
    active: rain != null,
    rainId,
    poolCoins: rain?.amount ?? tel?.poolCoins ?? null,
    joinWindowOpen: joinOpen,
    joinOpensInSec: opensIn,
    joinWindowRemainingSec: remaining,
    joinWindowTotalSec: joinTotalSec,
    captchaReady,
    captchaSolveSec: tel?.captchaSolveSec ?? null,
    captchaWaitingSec,
    joinAttempts: tel?.joinAttempts ?? 0,
    joinedNicknames: tel?.joinedNicknames ?? [],
    accountStatuses: tel?.accountStatuses ?? [],
    listenerConnected: input.listenerConnected,
    telemetry: tel ?? null,
    lastSummary: last != null ? formatRainJoinSummary(last) : null,
  };
}
