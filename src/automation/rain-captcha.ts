import { isTransientNetworkError, solveCaptcha } from "../captcha/solve.js";
import {
  rainTelemetryAccountCaptchaReady,
  rainTelemetryAccountCaptchaSolving,
  rainTelemetryCaptchaReady,
} from "./rain-telemetry.js";
import { appendLog, getAccount } from "../db/repositories.js";

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
const prewarmBlockedUntil = new Map<string, number>();
const finishedRainIds = new Set<string>();

export function markRainCaptchaFinished(rainId: string): void {
  if (!rainId) return;
  finishedRainIds.add(rainId);
  clearRainCaptcha(rainId);
  if (finishedRainIds.size > 40) {
    for (const id of finishedRainIds) {
      finishedRainIds.delete(id);
      if (finishedRainIds.size <= 25) break;
    }
  }
}

export function isRainCaptchaFinished(rainId: string): boolean {
  return finishedRainIds.has(rainId);
}

function prewarmFailureCooldownMs(): number {
  return Math.max(60_000, Number(process.env.RAIN_CAPTCHA_FAIL_COOLDOWN_MS ?? 300_000) || 300_000);
}

function slotKey(rainId: string, accountId?: number | null): string {
  if (accountId != null && Number.isFinite(accountId)) return `${rainId}:acct:${accountId}`;
  return `${rainId}:shared`;
}

function rainKeyPrefix(rainId: string): string {
  return `${rainId}:`;
}

function readCachedKey(key: string): string | null {
  const row = cache.get(key);
  if (!row) return null;
  if (Date.now() - row.at > tokenTtlMs()) {
    cache.delete(key);
    return null;
  }
  return row.token;
}

function logSolveDone(
  rainId: string,
  started: number,
  token: string | null,
  accountId?: number | null,
): void {
  const sec = ((Date.now() - started) / 1000).toFixed(1);
  const who = accountId != null ? ` acct ${accountId}` : "";
  console.log(`[rain-captcha] ${rainId.slice(0, 8)}…${who} ${token ? "ready" : "failed"} in ${sec}s`);
  if (token && accountId != null) {
    const nick = getAccount(accountId)?.nickname ?? `#${accountId}`;
    rainTelemetryAccountCaptchaReady(rainId, accountId, nick, parseFloat(sec));
  } else if (token && accountId == null) {
    rainTelemetryCaptchaReady(rainId, parseFloat(sec));
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

function startSolveForSlot(
  rainId: string,
  accountId?: number | null,
  opts?: { bypassCooldown?: boolean },
): void {
  const key = slotKey(rainId, accountId);
  if (isRainCaptchaFinished(rainId)) return;
  if (readCachedKey(key)) return;
  if (inflight.has(key)) return;

  const blockKey = accountId != null ? `${rainId}:${accountId}` : rainId;
  const blocked = prewarmBlockedUntil.get(blockKey);
  if (blocked != null && Date.now() < blocked) {
    if (!opts?.bypassCooldown) return;
    prewarmBlockedUntil.delete(blockKey);
  }

  const started = Date.now();
  console.log(
    `[rain-captcha] solve start ${rainId.slice(0, 8)}…${accountId != null ? ` acct ${accountId}` : " shared"}`,
  );
  if (accountId != null) {
    const nick = getAccount(accountId)?.nickname ?? `#${accountId}`;
    rainTelemetryAccountCaptchaSolving(rainId, accountId, nick);
  }
  const p = solveHcaptchaWithRetry()
    .then((token) => {
      logSolveDone(rainId, started, token, accountId);
      if (token) {
        cache.set(key, { token, at: Date.now() });
        prewarmBlockedUntil.delete(blockKey);
      }
      return token;
    })
    .catch((err) => {
      const msg = err instanceof Error ? err.message : String(err);
      console.warn(`[rain-captcha] solve failed ${rainId.slice(0, 8)}…: ${msg}`);
      const cooldown = prewarmFailureCooldownMs();
      prewarmBlockedUntil.set(blockKey, Date.now() + cooldown);
      appendLog({
        accountId: accountId ?? undefined,
        category: "rain",
        message: "Rain captcha solve failed",
        detail: `${rainId.slice(0, 8)}… · ${msg.slice(0, 200)} · retry in ~${Math.round(cooldown / 1000)}s`,
      });
      return null;
    })
    .finally(() => {
      inflight.delete(key);
    });
  inflight.set(key, p);
}

/** Legacy single-slot prewarm (shared key). Prefer prewarmRainCaptchasParallel. */
export function prewarmRainCaptcha(rainId: string): void {
  if (!rainId) return;
  startSolveForSlot(rainId, null);
}

/** Start one 2Captcha task per account in parallel — fits ~2 min join windows for multi-account. */
export function prewarmRainCaptchasParallel(rainId: string, accountIds: number[]): void {
  if (!rainId || isRainCaptchaFinished(rainId)) return;
  const unique = [...new Set(accountIds.filter((id) => Number.isFinite(id)))];
  if (unique.length === 0) {
    prewarmRainCaptcha(rainId);
    return;
  }
  for (const id of unique) startSolveForSlot(rainId, id);
}

/** Wait until all account tokens exist (legacy / tests). Rain join uses per-account join-as-ready instead. */
export async function waitForRainCaptchasParallel(
  rainId: string,
  accountIds: number[],
  timeoutMs?: number,
): Promise<{ ready: number; total: number }> {
  const unique = [...new Set(accountIds.filter((id) => Number.isFinite(id)))];
  const total = unique.length;
  if (total === 0) return { ready: 0, total: 0 };
  prewarmRainCaptchasParallel(rainId, unique);
  const ms =
    timeoutMs ??
    Math.max(30_000, Number(process.env.RAIN_CAPTCHA_PARALLEL_WAIT_MS ?? 150_000) || 150_000);
  const deadline = Date.now() + ms;
  let ready = 0;
  while (Date.now() < deadline) {
    const tokens = await Promise.all(
      unique.map((id) => takeRainCaptchaToken(rainId, { accountId: id, forRainJoin: true })),
    );
    ready = tokens.filter(Boolean).length;
    if (ready >= total) break;
    await new Promise((r) => setTimeout(r, 1_000));
  }
  if (ready > 0 && ready === total) {
    appendLog({
      category: "rain",
      message: "Rain captchas ready",
      detail: `${rainId.slice(0, 8)}… · ${ready}/${total} account(s) · parallel`,
    });
  }
  return { ready, total };
}

export async function takeRainCaptchaToken(
  rainId: string,
  opts?: { forRainJoin?: boolean; accountId?: number | null },
): Promise<string | null> {
  if (isRainCaptchaFinished(rainId)) return null;
  const key = slotKey(rainId, opts?.accountId);

  const row = cache.get(key);
  if (row && opts?.forRainJoin) {
    const age = Date.now() - row.at;
    if (age > tokenMaxAgeForJoinMs()) {
      cache.delete(key);
    }
  }
  const cached = readCachedKey(key);
  if (cached) return cached;

  let p = inflight.get(key);
  if (!p) {
    startSolveForSlot(rainId, opts?.accountId ?? null, {
      bypassCooldown: !!opts?.forRainJoin,
    });
    p = inflight.get(key);
  }
  if (!p) {
    if (opts?.forRainJoin) {
      const acctId = opts?.accountId;
      const who = acctId != null ? getAccount(acctId)?.nickname ?? `#${acctId}` : "shared";
      appendLog({
        accountId: acctId ?? undefined,
        category: "rain",
        message: "Rain captcha not started",
        detail: `${who} · ${rainId.slice(0, 8)}… · check CAPTCHA_API_KEY / 2Captcha balance / prior solve cooldown`,
      });
    }
    return null;
  }
  return p;
}

export function clearRainCaptcha(rainId: string): void {
  const prefix = rainKeyPrefix(rainId);
  for (const k of [...cache.keys()]) {
    if (k === `${rainId}:shared` || k.startsWith(prefix)) cache.delete(k);
  }
  for (const k of [...inflight.keys()]) {
    if (k === `${rainId}:shared` || k.startsWith(prefix)) inflight.delete(k);
  }
}

export function rainCaptchaInflight(rainId: string): boolean {
  const prefix = rainKeyPrefix(rainId);
  for (const k of inflight.keys()) {
    if (k.startsWith(prefix) || k === `${rainId}:shared`) return true;
  }
  return false;
}

export function shouldInvalidateRainCaptcha(reason: string): boolean {
  return /captcha.*invalid|invalid.*captcha|complete the captcha|captcha again|token.*expired|reject.*captcha|wrong.*captcha|hcaptcha/i.test(
    reason,
  );
}

export function consumeRainCaptchaToken(rainId: string, accountId?: number | null): void {
  cache.delete(slotKey(rainId, accountId));
}
