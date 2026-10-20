import { isTransientNetworkError, solveCaptcha } from "../captcha/solve.js";
import { rainTelemetryCaptchaReady } from "./rain-telemetry.js";
import { appendLog } from "../db/repositories.js";

/** Drop cached token after this (ms). hCaptcha/RoRush often reject tokens older than ~2 min. */
function tokenTtlMs(): number {
  return Math.max(30_000, Number(process.env.CAPTCHA_TOKEN_TTL_MS ?? 110_000) || 110_000);
}

/** At join time, discard token older than this and solve again (site acceptance window). */
function tokenMaxAgeForJoinMs(): number {
  return Math.max(20_000, Number(process.env.CAPTCHA_TOKEN_MAX_AGE_MS ?? 90_000) || 90_000);
}

const cache = new Map<string, { token: string; at: number }>();
const inflight = new Map<string, Promise<string | null>>();
/** After 2Captcha "could not solve", avoid burning credits on repeated prewarms. */
const prewarmBlockedUntil = new Map<string, number>();

function prewarmFailureCooldownMs(): number {
  return Math.max(60_000, Number(process.env.RAIN_CAPTCHA_FAIL_COOLDOWN_MS ?? 300_000) || 300_000);
}

function cacheKey(rainId: string): string {
  return rainId;
}

function readCached(rainId: string): string | null {
  const row = cache.get(cacheKey(rainId));
  if (!row) return null;
  if (Date.now() - row.at > tokenTtlMs()) {
    cache.delete(cacheKey(rainId));
    return null;
  }
  return row.token;
}

function logSolveDone(rainId: string, started: number, token: string | null): void {
  const sec = ((Date.now() - started) / 1000).toFixed(1);
  console.log(
    `[rain-captcha] ${rainId.slice(0, 8)}… ${token ? "ready" : "failed"} in ${sec}s`,
  );
  if (token) {
    const solveSec = parseFloat(sec);
    rainTelemetryCaptchaReady(rainId, solveSec);
    appendLog({
      category: "rain",
      message: "Rain captcha ready",
      detail: `${rainId} · ${sec}s`,
    });
  }
}

async function solveHcaptchaWithRetry(): Promise<string | null> {
  try {
    return await solveCaptcha("hcaptcha");
  } catch (err) {
    if (!isTransientNetworkError(err)) throw err;
    console.warn("[rain-captcha] retry after network error…");
    return solveCaptcha("hcaptcha");
  }
}

/** Start solving before join window so the token is ready when join opens. */
export function prewarmRainCaptcha(rainId: string): void {
  if (!rainId || readCached(rainId)) return;
  if (inflight.has(cacheKey(rainId))) return;
  const blocked = prewarmBlockedUntil.get(rainId);
  if (blocked != null && Date.now() < blocked) return;
  const started = Date.now();
  console.log(`[rain-captcha] prewarm ${rainId.slice(0, 8)}…`);
  const p = solveHcaptchaWithRetry()
    .then((token) => {
      logSolveDone(rainId, started, token);
      if (token) {
        cache.set(cacheKey(rainId), { token, at: Date.now() });
        prewarmBlockedUntil.delete(rainId);
      }
      return token;
    })
    .catch((err) => {
      const msg = err instanceof Error ? err.message : String(err);
      console.warn(`[rain-captcha] prewarm failed ${rainId.slice(0, 8)}…: ${msg}`);
      prewarmBlockedUntil.set(rainId, Date.now() + prewarmFailureCooldownMs());
      return null;
    })
    .finally(() => {
      inflight.delete(cacheKey(rainId));
    });
  inflight.set(cacheKey(rainId), p);
}

/** Use cached token from prewarm when possible; otherwise solve now. */
export async function takeRainCaptchaToken(
  rainId: string,
  opts?: { forRainJoin?: boolean },
): Promise<string | null> {
  const row = cache.get(cacheKey(rainId));
  if (row && opts?.forRainJoin) {
    const age = Date.now() - row.at;
    if (age > tokenMaxAgeForJoinMs()) {
      console.log(
        `[rain-captcha] cached token too old for join (${(age / 1000).toFixed(0)}s) — refreshing`,
      );
      cache.delete(cacheKey(rainId));
    }
  }
  const cached = readCached(rainId);
  if (cached) return cached;

  let p = inflight.get(cacheKey(rainId));
  if (!p) {
    const started = Date.now();
    console.log(`[rain-captcha] solve now ${rainId.slice(0, 8)}… (no cache)`);
    p = solveHcaptchaWithRetry().then((token) => {
      logSolveDone(rainId, started, token);
      if (token) cache.set(cacheKey(rainId), { token, at: Date.now() });
      return token;
    });
    inflight.set(cacheKey(rainId), p);
    void p.finally(() => inflight.delete(cacheKey(rainId)));
  }
  return p;
}

export function clearRainCaptcha(rainId: string): void {
  cache.delete(cacheKey(rainId));
  inflight.delete(cacheKey(rainId));
}

export function rainCaptchaInflight(rainId: string): boolean {
  return inflight.has(cacheKey(rainId));
}

/** RoRush rejected the token — safe to request a fresh solve. */
export function shouldInvalidateRainCaptcha(reason: string): boolean {
  return /captcha.*invalid|invalid.*captcha|token.*expired|reject.*captcha|wrong.*captcha|hcaptcha/i.test(
    reason,
  );
}
