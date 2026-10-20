import type { RainState } from "../rorush/types.js";
import { rainJoinStageBounds, rainJoinWindowOpen, rainJoinWindowRemainingMs } from "./rain-join.js";

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
    };
    active.set(rainId, r);
  }
  return r;
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

export function rainTelemetryCaptchaReady(rainId: string, solveSec: number): void {
  const r = row(rainId);
  r.captchaReadyAtMs = Date.now();
  r.captchaSolveSec = solveSec;
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
}

export function rainTelemetryAccountFailed(rainId: string, nickname: string, reason: string): void {
  const r = row(rainId);
  const line = `${nickname}: ${reason.slice(0, 100)}`;
  r.lastErrors = [line, ...r.lastErrors].slice(0, 5);
}

export function rainTelemetryFinish(rainId: string): RainTelemetryRow | null {
  const r = active.get(rainId);
  if (!r) return null;
  r.finishedAtMs = Date.now();
  lastFinished = { ...r };
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
  joinWindowRemainingSec: number;
  captchaReady: boolean;
  captchaSolveSec: number | null;
  captchaWaitingSec: number | null;
  joinAttempts: number;
  joinedNicknames: string[];
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

  let captchaWaitingSec: number | null = null;
  if (tel && !tel.captchaReadyAtMs) {
    captchaWaitingSec = Math.round((now - tel.createdAtMs) / 1000);
  }

  const last = rainTelemetryLastFinished();

  return {
    active: rain != null,
    rainId,
    poolCoins: rain?.amount ?? tel?.poolCoins ?? null,
    joinWindowOpen: joinOpen,
    joinWindowRemainingSec: remaining,
    captchaReady: !!tel?.captchaReadyAtMs,
    captchaSolveSec: tel?.captchaSolveSec ?? null,
    captchaWaitingSec,
    joinAttempts: tel?.joinAttempts ?? 0,
    joinedNicknames: tel?.joinedNicknames ?? [],
    listenerConnected: input.listenerConnected,
    telemetry: tel ?? null,
    lastSummary: last != null ? formatRainJoinSummary(last) : null,
  };
}
