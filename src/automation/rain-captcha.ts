import {
  isCaptchaRetryableTaskError,
  isTransientNetworkError,
  solveCaptcha,
  type CaptchaSolveOptions,
} from "../captcha/solve.js";
import {
  captchaSolveLeadMs,
  effectiveRainForTiming,
  rainAllowsPaidCaptchaSolve,
  rainCaptchaCancelAfterMs,
  rainCaptchaSolveWindow,
  rainJoinOpensInMs,
  rainJoinWindowOpen,
} from "./rain-timing.js";
import {
  rainTelemetryAccountCaptchaReady,
  rainTelemetryAccountCaptchaSolving,
  rainTelemetryCaptchaReady,
} from "./rain-telemetry.js";
import { appendLog, getAccount } from "../db/repositories.js";
import type { RainState } from "../rorush/types.js";

/* ── Rain metadata (from engine SignalR merges) ─────────────────────────── */

const rainMetaById = new Map<string, RainState>();
const billingSkipLogged = new Set<string>();

export function syncRainCaptchaMeta(rain: RainState): void {
  if (!rain.rainId) return;
  rainMetaById.set(rain.rainId, effectiveRainForTiming(rain));
}

export function dropRainCaptchaMeta(rainId: string): void {
  if (!rainId) return;
  rainMetaById.delete(rainId);
  billingSkipLogged.delete(rainId);
}

function rainPaidSolvesGloballyEnabled(): boolean {
  const raw = process.env.CAPTCHA_RAIN_PAID_SOLVES?.trim().toLowerCase();
  return !(raw === "0" || raw === "false" || raw === "no" || raw === "off");
}

function getRainMeta(rainId: string): RainState | undefined {
  return rainMetaById.get(rainId);
}

function paidSolveAllowed(rainId: string, now = Date.now()): boolean {
  if (!rainPaidSolvesGloballyEnabled()) return false;
  if (isRainCaptchaFinished(rainId)) return false;
  const rain = getRainMeta(rainId);
  if (!rain) {
    if (!billingSkipLogged.has(`${rainId}:nometa`)) {
      billingSkipLogged.add(`${rainId}:nometa`);
      console.warn(`[rain-captcha] skip — no rain metadata (${rainId.slice(0, 8)}…)`);
    }
    return false;
  }
  if (!rainAllowsPaidCaptchaSolve(rain, now)) {
    if (!billingSkipLogged.has(rainId)) {
      billingSkipLogged.add(rainId);
      console.warn(
        `[rain-captcha] skip — outside solve window (${rainId.slice(0, 8)}… · join in ${Math.round(rainJoinOpensInMs(rain, now) / 1000)}s)`,
      );
    }
    return false;
  }
  billingSkipLogged.delete(rainId);
  billingSkipLogged.delete(`${rainId}:nometa`);
  return true;
}

/* ── Token cache ─────────────────────────────────────────────────────────── */

function tokenTtlMs(): number {
  return Math.max(30_000, Number(process.env.CAPTCHA_TOKEN_TTL_MS ?? 110_000) || 110_000);
}

function tokenMaxAgeForJoinMs(): number {
  return Math.max(20_000, Number(process.env.CAPTCHA_TOKEN_MAX_AGE_MS ?? 90_000) || 90_000);
}

const cache = new Map<string, { token: string; at: number }>();
const inflight = new Map<string, Promise<string | null>>();
const prewarmBlockedUntil = new Map<string, number>();
const finishedRainIds = new Set<string>();
const paidTasksPerSlot = new Map<string, number>();
const solveStartedAt = new Map<string, number>();
const joinHedgeLaunched = new Set<string>();

function slotKey(rainId: string, accountId?: number | null): string {
  if (accountId != null && Number.isFinite(accountId)) return `${rainId}:acct:${accountId}`;
  return `${rainId}:shared`;
}

function rainKeyPrefix(rainId: string): string {
  return `${rainId}:`;
}

function maxRainPaidTasksPerSlot(): number {
  return Math.max(1, Number(process.env.CAPTCHA_RAIN_MAX_TASKS_PER_SLOT ?? 4) || 4);
}

function budgetRemaining(budgetKey: string): number {
  const used = paidTasksPerSlot.get(budgetKey) ?? 0;
  return Math.max(0, maxRainPaidTasksPerSlot() - used);
}

function recordPaidTask(budgetKey: string): void {
  paidTasksPerSlot.set(budgetKey, (paidTasksPerSlot.get(budgetKey) ?? 0) + 1);
}

function clearPaidTasksForRain(rainId: string): void {
  const prefix = rainKeyPrefix(rainId);
  for (const k of [...paidTasksPerSlot.keys()]) {
    if (k.startsWith(prefix) || k === `${rainId}:shared`) paidTasksPerSlot.delete(k);
  }
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

function tokenTooOldForJoin(at: number): boolean {
  return Date.now() - at > tokenMaxAgeForJoinMs() * 0.9;
}

function clearJoinHedgeForRain(rainId: string): void {
  const prefix = rainKeyPrefix(rainId);
  for (const k of [...joinHedgeLaunched]) {
    if (k.startsWith(prefix)) joinHedgeLaunched.delete(k);
  }
  for (const k of [...solveStartedAt.keys()]) {
    if (k.startsWith(prefix)) solveStartedAt.delete(k);
  }
}

export function markRainCaptchaFinished(rainId: string): void {
  if (!rainId) return;
  finishedRainIds.add(rainId);
  dropRainCaptchaMeta(rainId);
  clearPaidTasksForRain(rainId);
  clearJoinHedgeForRain(rainId);
  clearRainCaptcha(rainId);
  for (const k of [...joinHedgeLaunched]) {
    if (k.startsWith(rainKeyPrefix(rainId))) joinHedgeLaunched.delete(k);
  }
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

/* ── 2Captcha solve (single task default; optional dual/hedge via env) ─── */

function rainCaptchaDualStartEnabled(): boolean {
  const raw = process.env.CAPTCHA_RAIN_DUAL_START?.trim().toLowerCase();
  return raw === "1" || raw === "true" || raw === "yes" || raw === "on";
}

/** When join is already open and we have no token, fire two tasks at once (slow queue rescue). */
function rainCaptchaLateParallelEnabled(): boolean {
  const raw = process.env.CAPTCHA_RAIN_LATE_PARALLEL?.trim().toLowerCase();
  return !(raw === "0" || raw === "false" || raw === "no" || raw === "off");
}

function isLateRainCaptchaStart(rain: RainState, now = Date.now()): boolean {
  return rainJoinWindowOpen(rain, now) && rainJoinOpensInMs(rain, now) <= 0;
}

function buildRainSolveOptions(rain: RainState, now = Date.now()): CaptchaSolveOptions {
  const lateJoin = isLateRainCaptchaStart(rain, now);
  const taskAttempts = Math.max(
    1,
    Number(process.env.CAPTCHA_RAIN_TASK_ATTEMPTS ?? 1) || 1,
  );
  return {
    cancelAfterMs: rainCaptchaCancelAfterMs(rain, now),
    taskAttempts: lateJoin ? 1 : taskAttempts,
  };
}

function rainCaptchaUrgent(rain: RainState, now = Date.now()): boolean {
  return rainJoinWindowOpen(rain, now) || rainJoinOpensInMs(rain, now) <= captchaSolveLeadMs();
}

function failureCooldownMs(rain: RainState, workerFail: boolean): number {
  const base = workerFail
    ? Math.max(8_000, Number(process.env.RAIN_CAPTCHA_WORKER_FAIL_COOLDOWN_MS ?? 15_000) || 15_000)
    : Math.max(20_000, Number(process.env.RAIN_CAPTCHA_FAIL_COOLDOWN_MS ?? 25_000) || 25_000);
  if (rainCaptchaUrgent(rain)) {
    return Math.min(
      base,
      Math.max(4_000, Number(process.env.RAIN_CAPTCHA_URGENT_FAIL_COOLDOWN_MS ?? 8_000) || 8_000),
    );
  }
  return base;
}

function isWorkerUnsolvableError(err: unknown): boolean {
  const msg = err instanceof Error ? err.message : String(err);
  return /workers could not solve|could not solve the captcha|unsolvable|ERROR_CAPTCHA_UNSOLVABLE/i.test(
    msg,
  );
}

async function solveOneRainHcaptcha(rain: RainState, budgetKey: string): Promise<string | null> {
  const now = Date.now();
  const opts = buildRainSolveOptions(rain, now);
  const hedgeAfterMs = Math.max(0, Number(process.env.CAPTCHA_RAIN_HEDGE_AFTER_MS ?? 0) || 0);
  const dualStart = rainCaptchaDualStartEnabled();
  const lateParallel =
    isLateRainCaptchaStart(rain, now) &&
    rainCaptchaLateParallelEnabled() &&
    budgetRemaining(budgetKey) >= 2;

  if (budgetRemaining(budgetKey) < 1) {
    console.warn(`[rain-captcha] spend cap ${maxRainPaidTasksPerSlot()} reached (${budgetKey.slice(0, 18)}…)`);
    return null;
  }

  if (lateParallel) {
    console.warn(
      `[rain-captcha] LATE start (join open, no token) — 2 parallel 2Captcha tasks · poll up to ${Math.round((opts.cancelAfterMs ?? 90_000) / 1000)}s`,
    );
    recordPaidTask(budgetKey);
    recordPaidTask(budgetKey);
    return new Promise<string | null>((resolve, reject) => {
      let settled = false;
      let failures = 0;
      const finish = (token: string | null) => {
        if (settled || token == null) return;
        settled = true;
        resolve(token);
      };
      const fail = (err: unknown) => {
        failures++;
        if (!settled && failures >= 2) {
          settled = true;
          reject(err instanceof Error ? err : new Error(String(err)));
        }
      };
      void solveCaptcha("hcaptcha", opts).then(finish).catch(fail);
      void solveCaptcha("hcaptcha", opts).then(finish).catch(fail);
    });
  }

  if (!dualStart && hedgeAfterMs <= 0) {
    recordPaidTask(budgetKey);
    return solveCaptcha("hcaptcha", opts);
  }

  return new Promise<string | null>((resolve, reject) => {
    let settled = false;
    let launched = 0;
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
      if (budgetRemaining(budgetKey) < 1) {
        if (launched === 0) fail(new Error("Rain captcha spend cap reached"));
        return;
      }
      recordPaidTask(budgetKey);
      launched++;
      if (label) console.log(`[rain-captcha] ${label}`);
      void solveCaptcha("hcaptcha", opts)
        .then(finish)
        .catch((err) => {
          failures++;
          if (!settled && failures >= launched) fail(err);
        });
    };

    launch("primary 2Captcha task");
    const dualDelayMs = Math.max(
      0,
      Number(process.env.CAPTCHA_RAIN_DUAL_START_DELAY_MS ?? 10_000) || 10_000,
    );
    if (dualStart) {
      setTimeout(() => {
        if (!settled) launch("dual-start (optional)");
      }, dualDelayMs);
    }
    if (hedgeAfterMs > 0) {
      setTimeout(() => {
        if (!settled) launch("hedge (optional)");
      }, hedgeAfterMs);
    }
  });
}

async function solveWithWorkerRetries(rain: RainState, budgetKey: string): Promise<string | null> {
  const maxAttempts = Math.max(
    1,
    Number(
      process.env.RAIN_CAPTCHA_WORKER_RETRIES ??
        (rainCaptchaUrgent(rain) ? 2 : 1),
    ) || 1,
  );
  let lastErr: unknown;
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      const token = await solveOneRainHcaptcha(rain, budgetKey);
      if (token) return token;
      if (budgetRemaining(budgetKey) < 1) return null;
    } catch (err) {
      lastErr = err;
      const retry =
        attempt < maxAttempts &&
        (isCaptchaRetryableTaskError(err) ||
          isTransientNetworkError(err) ||
          isWorkerUnsolvableError(err));
      if (!retry) throw err;
      console.warn(`[rain-captcha] worker retry ${attempt + 1}/${maxAttempts}`);
      await new Promise((r) =>
        setTimeout(r, Math.max(400, Number(process.env.CAPTCHA_RAIN_RETRY_MS ?? 800) || 800)),
      );
    }
  }
  if (lastErr) throw lastErr;
  return null;
}

function prewarmFailureCooldownMs(): number {
  return Math.max(20_000, Number(process.env.RAIN_CAPTCHA_FAIL_COOLDOWN_MS ?? 25_000) || 25_000);
}

function logSolveStart(rainId: string, accountId: number | null | undefined, rain: RainState): void {
  const msUntilJoin = rainJoinOpensInMs(rain, Date.now());
  const cancelSec = Math.round(rainCaptchaCancelAfterMs(rain) / 1000);
  const who = accountId != null ? `acct ${accountId}` : "shared";
  const late = isLateRainCaptchaStart(rain);
  console.log(
    `[rain-captcha] solve start ${rainId.slice(0, 8)}… ${who} · msUntilJoin=${msUntilJoin} · join in ${Math.round(msUntilJoin / 1000)}s · poll up to ${cancelSec}s${late ? " · LATE (need tip-stage prewarm or git pull 8256c6d+)" : ""}`,
  );
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

function startSolveForSlot(
  rainId: string,
  accountId?: number | null,
  opts?: { bypassCooldown?: boolean },
): void {
  const key = slotKey(rainId, accountId);
  if (!paidSolveAllowed(rainId)) return;
  if (isRainCaptchaFinished(rainId)) return;
  if (readCachedKey(key)) return;
  if (inflight.has(key)) return;

  const rain = getRainMeta(rainId);
  if (!rain) return;

  const blockKey = accountId != null ? `${rainId}:${accountId}` : rainId;
  const blocked = prewarmBlockedUntil.get(blockKey);
  const urgent = opts?.bypassCooldown || rainCaptchaUrgent(rain);
  if (blocked != null && Date.now() < blocked) {
    if (!urgent) return;
    prewarmBlockedUntil.delete(blockKey);
  }

  const started = Date.now();
  solveStartedAt.set(key, started);
  logSolveStart(rainId, accountId ?? null, rain);
  if (accountId != null) {
    const nick = getAccount(accountId)?.nickname ?? `#${accountId}`;
    rainTelemetryAccountCaptchaSolving(rainId, accountId, nick);
  }

  const budgetKey = slotKey(rainId, accountId);
  const p = solveWithWorkerRetries(rain, budgetKey)
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
      const cooldown = failureCooldownMs(rain, workerFail);
      prewarmBlockedUntil.set(blockKey, Date.now() + cooldown);
      appendLog({
        accountId: accountId ?? undefined,
        category: "rain",
        message: workerFail ? "Rain captcha unsolvable (2Captcha)" : "Rain captcha solve failed",
        detail: `${rainId.slice(0, 8)}… · ${msg.slice(0, 200)} · retry in ~${Math.round(cooldown / 1000)}s`,
      });
      return null;
    })
    .finally(() => {
      inflight.delete(key);
      solveStartedAt.delete(key);
    });
  inflight.set(key, p);
}

/** One optional extra 2Captcha task per slot when join is open and the first task is still slow. */
export function maybeJoinWindowCaptchaHedge(rainId: string, accountIds: number[]): void {
  const hedgeAfterMs = Math.max(0, Number(process.env.CAPTCHA_RAIN_HEDGE_AFTER_MS ?? 0) || 0);
  if (hedgeAfterMs <= 0) return;
  if (!paidSolveAllowed(rainId)) return;
  const rain = getRainMeta(rainId);
  if (!rain || !rainJoinWindowOpen(rain)) return;

  const unique = [...new Set(accountIds.filter((id) => Number.isFinite(id)))];
  for (const id of unique) {
    const key = slotKey(rainId, id);
    if (readCachedKey(key)) continue;
    if (!inflight.has(key)) continue;
    if (joinHedgeLaunched.has(key)) continue;
    const startedAt = solveStartedAt.get(key);
    if (startedAt == null || Date.now() - startedAt < hedgeAfterMs) continue;
    const budgetKey = key;
    if (budgetRemaining(budgetKey) < 1) continue;

    joinHedgeLaunched.add(key);
    recordPaidTask(budgetKey);
    const msUntilJoin = rainJoinOpensInMs(rain);
    console.log(
      `[rain-captcha] join hedge ${rainId.slice(0, 8)}… acct ${id} · msUntilJoin=${msUntilJoin}`,
    );
    void solveCaptcha("hcaptcha", buildRainSolveOptions(rain)).then((token) => {
      if (token && !isRainCaptchaFinished(rainId) && !readCachedKey(key)) {
        cache.set(key, { token, at: Date.now() });
      }
    });
  }
}

/* ── Public API ──────────────────────────────────────────────────────────── */

export function prewarmRainCaptcha(rainId: string): void {
  if (!rainId) return;
  startSolveForSlot(rainId, null);
}

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

export function prewarmRainCaptchasParallel(rainId: string, accountIds: number[]): void {
  if (!rainId || isRainCaptchaFinished(rainId)) return;
  const unique = [...new Set(accountIds.filter((id) => Number.isFinite(id)))];
  if (unique.length === 0) {
    prewarmRainCaptcha(rainId);
    return;
  }
  for (const id of unique) startSolveForSlot(rainId, id);
}

/** Single entry: start paid solves when timing + billing allow (engine + join loop). */
export function ensureRainCaptchasRunning(rainId: string, accountIds: number[]): void {
  if (!rainId || isRainCaptchaFinished(rainId)) return;
  const rain = getRainMeta(rainId);
  if (!rain || !rainCaptchaSolveWindow(rain)) return;
  prewarmRainCaptchasParallel(rainId, accountIds);
}

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
  if (row && opts?.forRainJoin && Date.now() - row.at > tokenMaxAgeForJoinMs()) {
    cache.delete(key);
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
  if (!p && paidSolveAllowed(rainId)) {
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
        detail: `${who} · ${rainId.slice(0, 8)}… · billing window / API key / cooldown`,
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
