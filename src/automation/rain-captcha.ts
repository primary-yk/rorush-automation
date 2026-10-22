import {
  isCaptchaRetryableTaskError,
  isTransientNetworkError,
  solveCaptcha,
  type CaptchaSolveOptions,
} from "../captcha/solve.js";
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
/** Paid 2Captcha createTask calls per rain slot (rainId + account). */
const paidTasksPerSlot = new Map<string, number>();

function maxRainPaidTasksPerSlot(): number {
  return Math.max(1, Number(process.env.CAPTCHA_RAIN_MAX_TASKS_PER_SLOT ?? 3) || 3);
}

function slotBudgetKey(rainId: string, accountId?: number | null): string {
  return slotKey(rainId, accountId);
}

function rainPaidTaskBudgetRemaining(budgetKey: string): number {
  const used = paidTasksPerSlot.get(budgetKey) ?? 0;
  return Math.max(0, maxRainPaidTasksPerSlot() - used);
}

function recordRainPaidTask(budgetKey: string): void {
  paidTasksPerSlot.set(budgetKey, (paidTasksPerSlot.get(budgetKey) ?? 0) + 1);
}

function clearPaidTasksForRain(rainId: string): void {
  const prefix = rainKeyPrefix(rainId);
  for (const k of [...paidTasksPerSlot.keys()]) {
    if (k.startsWith(prefix) || k === `${rainId}:shared`) paidTasksPerSlot.delete(k);
  }
}

export function markRainCaptchaFinished(rainId: string): void {
  if (!rainId) return;
  finishedRainIds.add(rainId);
  clearPaidTasksForRain(rainId);
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
  return Math.max(30_000, Number(process.env.RAIN_CAPTCHA_FAIL_COOLDOWN_MS ?? 120_000) || 120_000);
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

function isWorkerUnsolvableError(err: unknown): boolean {
  const msg = err instanceof Error ? err.message : String(err);
  return /workers could not solve|could not solve the captcha|unsolvable|ERROR_CAPTCHA_UNSOLVABLE/i.test(
    msg,
  );
}

function rainCaptchaDualStartEnabled(): boolean {
  const raw = process.env.CAPTCHA_RAIN_DUAL_START?.trim().toLowerCase();
  if (raw === "1" || raw === "true" || raw === "yes" || raw === "on") return true;
  return false;
}

function rainCaptchaSolveOptions(): CaptchaSolveOptions {
  return {
    cancelAfterMs: Math.max(
      28_000,
      Number(process.env.CAPTCHA_RAIN_CANCEL_AFTER_MS ?? 42_000) || 42_000,
    ),
    taskAttempts: Math.max(1, Number(process.env.CAPTCHA_RAIN_TASK_ATTEMPTS ?? 2) || 2),
  };
}

/** Parallel 2Captcha tasks — first token wins (dual-start + optional late hedge). */
async function solveRainCaptchaWithHedge(budgetKey: string): Promise<string | null> {
  const opts = rainCaptchaSolveOptions();
  const hedgeAfterMs = Math.max(
    0,
    Number(process.env.CAPTCHA_RAIN_HEDGE_AFTER_MS ?? 0) || 0,
  );
  const dualStart = rainCaptchaDualStartEnabled();

  if (rainPaidTaskBudgetRemaining(budgetKey) < 1) {
    console.warn(
      `[rain-captcha] paid task cap (${maxRainPaidTasksPerSlot()}) reached for ${budgetKey.slice(0, 20)}… — skip new 2Captcha tasks`,
    );
    return null;
  }

  return new Promise<string | null>((resolve, reject) => {
    let settled = false;
    let tasksLaunched = 0;
    let failures = 0;

    const finish = (token: string | null) => {
      if (settled || token == null) return;
      settled = true;
      resolve(token);
    };
    const fail = (err: unknown) => {
      if (settled) return;
      settled = true;
      reject(err instanceof Error ? err : new Error(String(err)));
    };

    const launch = (label?: string) => {
      if (rainPaidTaskBudgetRemaining(budgetKey) < 1) {
        if (tasksLaunched === 0) {
          fail(new Error("Rain captcha spend cap reached (CAPTCHA_RAIN_MAX_TASKS_PER_SLOT)"));
        }
        return;
      }
      recordRainPaidTask(budgetKey);
      tasksLaunched++;
      if (label) console.log(`[rain-captcha] ${label}`);
      void solveCaptcha("hcaptcha", opts)
        .then(finish)
        .catch((err) => {
          failures++;
          if (!settled && failures >= tasksLaunched) fail(err);
        });
    };

    launch("primary 2Captcha task");

    const dualDelayMs = Math.max(
      0,
      Number(process.env.CAPTCHA_RAIN_DUAL_START_DELAY_MS ?? 10_000) || 10_000,
    );
    if (dualStart) {
      setTimeout(() => {
        if (settled) return;
        launch("dual-start — second task (staggered, avoids queue pile-up)");
      }, dualDelayMs);
    }

    if (hedgeAfterMs > 0) {
      setTimeout(() => {
        if (settled) return;
        launch("hedge — extra task (queue still slow)");
      }, hedgeAfterMs);
    }
  });
}

async function solveHcaptchaWithRetry(budgetKey: string): Promise<string | null> {
  const maxAttempts = Math.max(1, Number(process.env.RAIN_CAPTCHA_WORKER_RETRIES ?? 2) || 2);
  let lastErr: unknown;
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      const token = await solveRainCaptchaWithHedge(budgetKey);
      if (token) return token;
      if (rainPaidTaskBudgetRemaining(budgetKey) < 1) return null;
    } catch (err) {
      lastErr = err;
      const retry =
        attempt < maxAttempts &&
        (isCaptchaRetryableTaskError(err) ||
          isTransientNetworkError(err) ||
          isWorkerUnsolvableError(err));
      if (!retry) throw err;
      const why = isWorkerUnsolvableError(err)
        ? "2Captcha workers failed"
        : /timed out|processing stall/i.test(err instanceof Error ? err.message : String(err))
          ? "captcha queue stall"
          : "network";
      console.warn(`[rain-captcha] retry ${attempt + 1}/${maxAttempts} after ${why}…`);
      const retryMs = Math.max(
        400,
        Number(process.env.CAPTCHA_RAIN_RETRY_MS ?? 800) || 800,
      );
      await new Promise((r) => setTimeout(r, retryMs));
    }
  }
  if (lastErr) throw lastErr;
  return null;
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
  const budgetKey = slotBudgetKey(rainId, accountId);
  const p = solveHcaptchaWithRetry(budgetKey)
    .then((token) => {
      logSolveDone(rainId, started, token, accountId);
      if (token && !isRainCaptchaFinished(rainId)) {
        cache.set(key, { token, at: Date.now() });
        prewarmBlockedUntil.delete(blockKey);
      }
      return token && !isRainCaptchaFinished(rainId) ? token : null;
    })
    .catch((err) => {
      const msg = err instanceof Error ? err.message : String(err);
      console.warn(`[rain-captcha] solve failed ${rainId.slice(0, 8)}…: ${msg}`);
      const workerFail = isWorkerUnsolvableError(err);
      const cooldown = workerFail
        ? Math.max(8_000, Number(process.env.RAIN_CAPTCHA_WORKER_FAIL_COOLDOWN_MS ?? 20_000) || 20_000)
        : prewarmFailureCooldownMs();
      prewarmBlockedUntil.set(blockKey, Date.now() + cooldown);
      appendLog({
        accountId: accountId ?? undefined,
        category: "rain",
        message: workerFail ? "Rain captcha unsolvable (2Captcha)" : "Rain captcha solve failed",
        detail: workerFail
          ? `${rainId.slice(0, 8)}… · 2Captcha workers could not solve — auto-retrying (${msg.slice(0, 120)})`
          : `${rainId.slice(0, 8)}… · ${msg.slice(0, 200)} · retry in ~${Math.round(cooldown / 1000)}s`,
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

/** Drop cached/inflight tokens and start a new paid solve (explicit invalidation only). */
export function forceFreshRainCaptchas(rainId: string, accountIds: number[]): void {
  if (!rainId || isRainCaptchaFinished(rainId)) return;
  const unique = [...new Set(accountIds.filter((id) => Number.isFinite(id)))];
  for (const id of unique) {
    const key = slotKey(rainId, id);
    cache.delete(key);
    inflight.delete(key);
    prewarmBlockedUntil.delete(`${rainId}:${id}`);
  }
  prewarmRainCaptchasParallel(rainId, unique);
}

function tokenTooOldForJoin(at: number): boolean {
  return Date.now() - at > tokenMaxAgeForJoinMs() * 0.9;
}

/** At join stage: only pay again when there is no fresh token (keep prewarm from tip stage). */
export function refreshRainCaptchasForJoin(rainId: string, accountIds: number[]): void {
  if (!rainId || isRainCaptchaFinished(rainId)) return;
  const unique = [...new Set(accountIds.filter((id) => Number.isFinite(id)))];
  const needSolve: number[] = [];
  for (const id of unique) {
    const key = slotKey(rainId, id);
    const row = cache.get(key);
    if (row && !tokenTooOldForJoin(row.at) && readCachedKey(key)) continue;
    if (inflight.has(key)) continue;
    if (row && tokenTooOldForJoin(row.at)) cache.delete(key);
    needSolve.push(id);
  }
  if (needSolve.length === 0) return;
  prewarmRainCaptchasParallel(rainId, needSolve);
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

  if (opts?.forRainJoin) {
    const rowStale = cache.get(key);
    if (rowStale && tokenTooOldForJoin(rowStale.at)) {
      cache.delete(key);
      startSolveForSlot(rainId, opts?.accountId ?? null, { bypassCooldown: true });
    }
  }

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
  clearPaidTasksForRain(rainId);
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
