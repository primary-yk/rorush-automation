import { loadConfig } from "../config.js";
import type { RainState } from "../rorush/types.js";

export const DEFAULT_JOIN_STAGE_MS = 90_000;

/**
 * RoRush usually sends epoch ms; some payloads use unix seconds (~1e9–1e10).
 * Small values (unit tests, relative ms) are left unchanged.
 */
export function normalizeEpochMs(value: number | null | undefined): number | undefined {
  if (value == null || !Number.isFinite(value)) return undefined;
  if (value <= 0) return undefined;
  if (value >= 1_000_000_000 && value < 10_000_000_000) {
    return Math.round(value * 1000);
  }
  return Math.round(value);
}

/** Durations ≤180 are treated as seconds (RoRush API quirk); larger values are ms. */
export function normalizeDurationMs(value: number | null | undefined): number | undefined {
  if (value == null || !Number.isFinite(value)) return undefined;
  if (value >= 30 && value <= 180) return Math.round(value * 1000);
  return Math.round(value);
}

export function captchaSolveLeadMs(): number {
  return Math.max(
    60_000,
    Number(process.env.CAPTCHA_SOLVE_START_LEAD_MS ?? 120_000) || 120_000,
  );
}

export function rainJoinStageBounds(
  rain: RainState,
  now = Date.now(),
): { joinStart: number; joinEnd: number } | null {
  const joinDur = normalizeDurationMs(rain.joinStageDuration) ?? DEFAULT_JOIN_STAGE_MS;
  let joinStart = normalizeEpochMs(rain.joinStageStartTimestamp ?? undefined) ?? null;
  const created = normalizeEpochMs(rain.createdTimestamp);
  const tipDur = normalizeDurationMs(rain.tipStageDuration);
  if (joinStart == null && created != null && tipDur != null) {
    joinStart = created + tipDur;
  }
  if (joinStart == null) return null;
  return { joinStart, joinEnd: joinStart + joinDur };
}

export function rainJoinWindowOpen(rain: RainState, now = Date.now()): boolean {
  const bounds = rainJoinStageBounds(rain, now);
  if (!bounds) return false;
  return now >= bounds.joinStart && now <= bounds.joinEnd;
}

export function rainJoinWindowRemainingMs(rain: RainState, now = Date.now()): number {
  const bounds = rainJoinStageBounds(rain, now);
  if (!bounds || now > bounds.joinEnd) return 0;
  if (now < bounds.joinStart) return bounds.joinEnd - bounds.joinStart;
  return Math.max(0, bounds.joinEnd - now);
}

export function rainJoinOpensInMs(rain: RainState, now = Date.now()): number {
  const bounds = rainJoinStageBounds(rain, now);
  if (!bounds || now >= bounds.joinStart) return 0;
  return Math.max(0, bounds.joinStart - now);
}

/** When to start paid 2Captcha (tip stage lead + join window). */
export function rainCaptchaSolveWindow(rain: RainState, now = Date.now()): boolean {
  if (rainJoinWindowOpen(rain, now)) return true;
  const bounds = rainJoinStageBounds(rain, now);
  if (!bounds || now > bounds.joinEnd) return false;
  const msUntilJoin = bounds.joinStart - now;
  return msUntilJoin > 0 && msUntilJoin <= captchaSolveLeadMs();
}

/** Hub preconnect + captcha prep tick (solve window can be wider than hub-only prewarm env). */
export function rainJoinPrepShouldRun(rain: RainState, now = Date.now()): boolean {
  return rainCaptchaPrewarmWindow(rain, now) || rainCaptchaSolveWindow(rain, now);
}

export function rainCaptchaPrewarmWindow(rain: RainState, now = Date.now()): boolean {
  if (rainJoinWindowOpen(rain, now)) return true;
  const bounds = rainJoinStageBounds(rain, now);
  const leadMs = Math.max(
    60_000,
    Number(process.env.RAIN_CAPTCHA_PREWARM_BEFORE_JOIN_MS ?? 180_000) || 180_000,
  );
  if (!bounds) {
    const created = normalizeEpochMs(rain.createdTimestamp);
    return !!(created && now >= created && now - created < 45_000);
  }
  if (now > bounds.joinEnd) return false;
  if (now >= bounds.joinStart) return true;
  const msUntilJoin = bounds.joinStart - now;
  return msUntilJoin > 0 && msUntilJoin <= leadMs;
}

/** Bill 2Captcha during tip-stage lead, join window, and brief tail for in-flight tasks. */
export function rainAllowsPaidCaptchaSolve(rain: RainState, now = Date.now()): boolean {
  const bounds = rainJoinStageBounds(rain, now);
  if (!bounds) return false;
  if (now > bounds.joinEnd + 20_000) return false;
  if (rainCaptchaSolveWindow(rain, now)) return true;
  return false;
}

const JOIN_SUBMIT_BUFFER_MS = 12_000;

/**
 * How long to poll one 2Captcha task before cancel (auto fits ~90s join window).
 * Set CAPTCHA_RAIN_CANCEL_AFTER_MS>0 to override auto.
 */
export function rainCaptchaCancelAfterMs(rain: RainState, now = Date.now()): number {
  const envOverride = Number(process.env.CAPTCHA_RAIN_CANCEL_AFTER_MS ?? 0);
  if (Number.isFinite(envOverride) && envOverride > 0) {
    return Math.max(30_000, envOverride);
  }
  const bounds = rainJoinStageBounds(rain, now);
  if (!bounds) return 90_000;
  const joinDur = rain.joinStageDuration ?? DEFAULT_JOIN_STAGE_MS;
  if (now < bounds.joinStart) {
    const untilJoin = bounds.joinStart - now;
    return Math.min(150_000, Math.max(45_000, untilJoin + joinDur - JOIN_SUBMIT_BUFFER_MS));
  }
  return Math.max(35_000, bounds.joinEnd - now - JOIN_SUBMIT_BUFFER_MS);
}

export function maxFailures(): number {
  return loadConfig().MAX_REQUEST_FAILURES;
}
