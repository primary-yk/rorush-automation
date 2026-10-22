import { v4 as uuid } from "uuid";
import { isTransientNetworkError } from "../captcha/solve.js";
import {
  clearRainCaptcha,
  shouldInvalidateRainCaptcha,
  takeRainCaptchaToken,
} from "./rain-captcha.js";
import { effectiveLimboMinBetCoins, LIMBO_MIN_MULTIPLIER, loadConfig } from "../config.js";
import {
  isRainJoined,
  markRainJoined,
  trackJoinInflight,
} from "./rain-join-state.js";
import {
  appendLog,
  getAccount,
  getRainJoinBalanceBefore,
  patchRainJoinBalanceBefore,
  recordRainJoin,
  updateAccount,
  accountIdsWithSuccessfulRainJoin,
} from "../db/repositories.js";
import { parseBalanceCents } from "../rorush/balance-level.js";
import { ensureRealCoinsWallet, isFunCoinRainBlock } from "../rorush/balance-token.js";
import type { HubRegistry } from "../worker/hub-registry.js";
import { SIGNALR } from "../rorush/endpoints.js";
import { RoRushHub } from "../rorush/signalr-hub.js";
import type { RainState } from "../rorush/types.js";
import { ensureAuthenticated } from "../accounts/session-manager.js";
import {
  reportLimboOutcome,
  reportRainManualWagerClearRequired,
  reportRainOutcome,
  reportRainWagerClearing,
} from "../discord/reporter.js";

const WAGER_HINT =
  /wager|play.?through|recent|activity|requirement|must bet|bet before|wager lock|playthrough/i;

/** Balance (coins) before join — used to compute real rain earnings when the pool finishes. */
const rainBalanceBeforeJoin = new Map<string, number>();

function rainBalanceKey(accountId: number, rainId: string): string {
  return `${accountId}:${rainId}`;
}

async function readBalanceCoins(
  client: import("../rorush/http-client.js").RoRushHttpClient,
): Promise<number> {
  const raw = await client.getBalance();
  const cents = parseBalanceCents(raw);
  if (cents == null) return 0;
  return Math.abs(cents) >= 100 ? cents / 100 : cents;
}

function limboPayloadReqId(payload: unknown): string | undefined {
  if (typeof payload === "string") {
    const s = payload.trim();
    if (/^[0-9a-f-]{36}$/i.test(s)) return s;
    return undefined;
  }
  if (!payload || typeof payload !== "object") return undefined;
  const p = payload as Record<string, unknown>;
  const id = p.reqId ?? p.ReqId ?? p.requestId ?? p.RequestId;
  return typeof id === "string" ? id : undefined;
}

function normalizeLimboMultiplier(raw: number): number | null {
  if (!Number.isFinite(raw) || raw <= 0) return null;
  if (raw >= 10_000 && Number.isInteger(raw)) return raw / 100;
  if (raw >= 100 && Number.isInteger(raw)) return raw / 100;
  return raw;
}

function readLimboMultiplierFromObject(p: Record<string, unknown>): number | null {
  const directKeys = [
    "multiplier",
    "Multiplier",
    "crashMultiplier",
    "CrashMultiplier",
    "resultMultiplier",
    "gameMultiplier",
    "outcomeMultiplier",
    "point",
    "crashPoint",
    "bustMultiplier",
    "roll",
    "value",
    "result",
  ];
  for (const key of directKeys) {
    const v = p[key];
    if (typeof v === "number") {
      const n = normalizeLimboMultiplier(v);
      if (n != null && n >= 1) return n;
    }
    if (typeof v === "string") {
      const n = parseFloat(v.replace(/×|x/gi, "").trim());
      const norm = normalizeLimboMultiplier(n);
      if (norm != null && norm >= 1) return norm;
    }
  }
  for (const nested of ["result", "game", "data", "limbo", "limboResult", "payload", "Game"]) {
    const inner = p[nested];
    if (inner && typeof inner === "object") {
      const m = readLimboMultiplierFromObject(inner as Record<string, unknown>);
      if (m != null) return m;
    }
  }
  return null;
}

function readLimboIsWin(p: Record<string, unknown>): boolean | null {
  for (const key of ["isWin", "IsWin", "win", "Win", "won", "isWinner", "IsWinner"]) {
    if (p[key] === true || p[key] === 1) return true;
    if (p[key] === false || p[key] === 0) return false;
  }
  return null;
}

/** True when payload includes crash/target outcome (not a bare reqId ack). */
export function limboResultHasOutcome(payload: unknown): boolean {
  if (typeof payload === "string") {
    const s = payload.trim();
    if (/^[0-9a-f-]{36}$/i.test(s)) return false;
    try {
      return limboResultHasOutcome(JSON.parse(s) as unknown);
    } catch {
      return false;
    }
  }
  if (!payload || typeof payload !== "object") return false;
  const p = payload as Record<string, unknown>;
  if (readLimboMultiplierFromObject(p) != null) return true;
  if (readLimboIsWin(p) != null) return true;
  return false;
}

function limboResultMatchesReqId(payload: unknown, reqId: string): boolean {
  let body = payload;
  if (typeof body === "string") {
    const s = body.trim();
    if (s === reqId) return false;
    try {
      body = JSON.parse(s) as unknown;
    } catch {
      return false;
    }
  }
  if (!body || typeof body !== "object") return false;
  const id = limboPayloadReqId(body);
  if (id && id !== reqId) return false;
  return limboResultHasOutcome(body);
}

export function isWagerRejection(message: string): boolean {
  return WAGER_HINT.test(message);
}

export type RainJoinFailureKind =
  | "captcha"
  | "funcoin"
  | "wager"
  | "wager_limbo_off"
  | "wager_after_limbo"
  | "pool_filter"
  | "other";

export { isFunCoinRainBlock };

/** User-facing bucket for rain join failures (wager before captcha when limbo was tried). */
export const MANUAL_WAGER_CLEAR_MESSAGE =
  "Manual wager clear required — auto limbo turned off (balance below RoRush limbo minimum)";

export function isManualWagerClearReason(message: string): boolean {
  return /manual wager clear required/i.test(message);
}

export function classifyRainJoinFailure(
  message: string,
  ctx?: { wagerClearAttempted?: boolean },
): RainJoinFailureKind {
  if (/wager required but limbo wager is off/i.test(message)) return "wager_limbo_off";
  if (/below filter|pool below|below minimum|join rain disabled/i.test(message)) {
    return "pool_filter";
  }
  if (ctx?.wagerClearAttempted) return "wager_after_limbo";
  if (isFunCoinRainBlock(message)) return "funcoin";
  if (
    /captcha|hcaptcha|complete the captcha|captcha again|token missing|2captcha|submitting captcha|not ready before the join window/i.test(
      message,
    )
  ) {
    return "captcha";
  }
  if (isWagerRejection(message)) return "wager";
  return "other";
}

const GENERIC_RAIN_JOIN_FAILURE = /^could not join this rain\.?$/i;

/** Final Discord/log reason when the join loop ends without success. */
export function buildRainJoinExhaustedReason(input: {
  lastReason: string;
  joinSubmissions: number;
  captchaTokenEverHeld: boolean;
}): string {
  const last = input.lastReason.trim();
  if (!GENERIC_RAIN_JOIN_FAILURE.test(last)) {
    if (isFunCoinRainBlock(last)) {
      return (
        "Rain join blocked — RoRush wallet was on **FunCoins** (real-coin rains need the main wallet). " +
        "The bot switches to real coins automatically before each join; toggle once on rorush.com if this repeats."
      );
    }
    return last;
  }

  if (isFunCoinRainBlock(last)) {
    return (
      "Rain join blocked — account was on **FunCoins**. Real rains require real coins; the bot now switches wallets before join."
    );
  }

  if (input.joinSubmissions === 0 && !input.captchaTokenEverHeld) {
    return (
      "Captcha was not ready before the join window closed. " +
      "Check **CAPTCHA_API_KEY**, **2Captcha balance**, and host logs for solve errors — this is not a wager issue."
    );
  }
  if (input.joinSubmissions > 0) {
    return (
      "Join failed after submitting captcha — RoRush did not accept the token (expired, invalid, or rejected). " +
      "The next rain will request a fresh 2Captcha solve."
    );
  }
  return (
    "Join window closed before a successful join. " +
    "If captcha solves were slow, check 2Captcha balance or host **#host-log** for captcha errors."
  );
}

/** Do not keep burning captcha/join attempts for these (same rain window). */
export function isPermanentRainJoinFailure(message: string): boolean {
  const m = message.trim();
  if (!m) return false;
  if (/already joined this rain/i.test(m)) return false;
  if (/join rain disabled for account/i.test(m)) return true;
  if (/rain amount.*below filter|below filter|pool below minimum|below minimum/i.test(m)) return true;
  if (/wager required but limbo wager is off/i.test(m)) return true;
  if (/enable `\/limbo set on:true`/i.test(m)) return true;
  if (/manual wager clear required/i.test(m)) return true;
  if (/account (is )?banned|permanently banned|disabled account/i.test(m)) return true;
  return false;
}

/** Failures that may succeed on retry within the same rain window. */
export function isRetryableRainFailure(message: string): boolean {
  if (isPermanentRainJoinFailure(message)) return false;
  if (isWagerRejection(message)) return true;
  if (isTransientNetworkError(message)) return true;
  if (/captcha|hcaptcha|token missing|too late|timed out|fetch failed|join timed out|retry timed out/i.test(message)) {
    return true;
  }
  // RoRush often returns generic copy — keep trying until the window closes.
  return true;
}

function accountStatusForRainFailure(message: string): { status: "idle" | "error"; last_error: string } {
  const captchaish = /captcha|hcaptcha|2captcha|token missing/i.test(message);
  return {
    status: isRetryableRainFailure(message) || captchaish ? "idle" : "error",
    last_error: message,
  };
}

export async function joinRainForAccount(input: {
  accountId: number;
  rain: RainState;
  hub: RoRushHub;
  captchaToken?: string | null;
  /** When false, caller reports to Discord (avoids “join failed” on captcha retries). */
  reportToDiscord?: boolean;
}): Promise<{ success: boolean; reason: string; wagerClearAttempted?: boolean }> {
  const { accountId, rain, hub } = input;
  if (isRainJoined(accountId, rain.rainId)) {
    return { success: true, reason: "Already joined this rain" };
  }
  return trackJoinInflight(accountId, rain.rainId, () =>
    joinRainForAccountOnce({
      accountId,
      rain,
      hub,
      captchaToken: input.captchaToken,
      reportToDiscord: input.reportToDiscord,
    }),
  );
}

async function joinRainForAccountOnce(input: {
  accountId: number;
  rain: RainState;
  hub: RoRushHub;
  captchaToken?: string | null;
  reportToDiscord?: boolean;
}): Promise<{ success: boolean; reason: string; wagerClearAttempted?: boolean }> {
  const { accountId, rain, hub } = input;
  const { account, client } = await ensureAuthenticated(accountId);
  let wagerClearAttempted = false;

  if (!account.join_rain) {
    return { success: false, reason: "Join rain disabled for account" };
  }

  if (isRainJoined(accountId, rain.rainId)) {
    return { success: true, reason: "Already joined this rain" };
  }

  const rainAmount = rain.amount ?? 0;
  if (rainAmount < account.min_rain_amount) {
    appendLog({
      accountId,
      category: "rain",
      message: "Rain join skipped (pool below minimum)",
      detail: `pool ${rainAmount.toFixed(2)} coins · min ${account.min_rain_amount.toFixed(2)} · ${rain.rainId.slice(0, 8)}…`,
    });
    return { success: false, reason: `Rain amount ${rainAmount} below filter` };
  }

  await ensureRealCoinsWallet(client, { accountId, nickname: account.nickname });

  const reqId = uuid();
  let captchaToken = input.captchaToken ?? null;

  const waitForJoinOutcome = (
    joinReqId: string,
  ): Promise<{ ok: boolean; message: string }> =>
    new Promise((resolve) => {
      const timeout = setTimeout(() => {
        cleanup();
        resolve({
          ok: false,
          message:
            "Rain join timed out (no success/failure from RoRush — often captcha or joining too late in the window)",
        });
      }, Math.max(30_000, Number(process.env.RAIN_JOIN_OUTCOME_MS ?? 90_000) || 90_000));

      const onSuccess = (payload: unknown) => {
        if (!matchesJoinReqId(payload, joinReqId)) return;
        cleanup();
        resolve({ ok: true, message: "Joined rain" });
      };
      const onFailure = (payload: unknown) => {
        const p = payload as { reqId?: string; message?: string };
        if (!p.reqId || p.reqId !== joinReqId) return;
        cleanup();
        resolve({ ok: false, message: p.message ?? "Rain join failed" });
      };

      const offOk = hub.on(SIGNALR.rain.receiveJoinSuccess, onSuccess);
      const offFail = hub.on(SIGNALR.rain.receiveFailure, onFailure);

      const cleanup = () => {
        clearTimeout(timeout);
        offOk();
        offFail();
      };
    });

  try {
    if (!captchaToken) {
      appendLog({
        accountId,
        category: "rain",
        message: "Solving rain captcha",
        detail: rain.rainId,
      });
      captchaToken = await takeRainCaptchaToken(rain.rainId, {
        forRainJoin: true,
        accountId,
      });
    }
    if (!captchaToken) {
      throw new Error(
        "Captcha token missing — set CAPTCHA_API_KEY (2Captcha/CapSolver for hCaptcha rain) and CAPTCHA_PROVIDER",
      );
    }
    appendLog({
      accountId,
      category: "rain",
      message: "Sending rain join",
      detail: `${rain.rainId} · pool ${rainAmount} coins${captchaToken ? " · captcha ready" : ""}`,
    });
    const outcomePromise = waitForJoinOutcome(reqId);
    await hub.joinRain({ reqId, rainId: rain.rainId, captchaToken });
    let outcome = await outcomePromise;

    if (!outcome.ok && isFunCoinRainBlock(outcome.message)) {
      await ensureRealCoinsWallet(client, { accountId, nickname: account.nickname });
      const retryReq = uuid();
      const retryOutcomePromise = waitForJoinOutcome(retryReq);
      await hub.joinRain({ reqId: retryReq, rainId: rain.rainId, captchaToken });
      outcome = await retryOutcomePromise;
    }

    if (!outcome.ok && isWagerRejection(outcome.message) && account.limbo_wager_enabled) {
      const minBet = effectiveLimboMinBetCoins();
      const walletForWager = await readBalanceCoins(client);

      if (walletForWager < minBet) {
        wagerClearAttempted = true;
        appendLog({
          accountId,
          category: "rain",
          message: "Wager lock — one limbo try below site minimum",
          detail: `${walletForWager.toFixed(2)} coins wallet · min bet ${minBet.toFixed(2)} · ${outcome.message}`,
        });
        try {
          await placeLimboWagerBet(
            accountId,
            client,
            hub,
            account,
            rainAmount,
            account.nickname,
            rain.rainId,
            {
              allowBelowMinOnce: true,
              betCoinsOverride: Math.max(0.01, walletForWager * 0.98),
              reasonLabel: "Wager clear attempt (balance below 5 coin min)",
            },
          );
        } catch (err) {
          appendLog({
            accountId,
            category: "limbo",
            message: "Low-balance wager attempt failed",
            detail: err instanceof Error ? err.message : String(err),
          });
        }
        const retryReq = uuid();
        outcome = await joinOnce(hub, retryReq, rain.rainId, accountId);
        if (!outcome.ok) {
          await applyManualWagerClearStop({
            accountId,
            nickname: account.nickname,
            rainId: rain.rainId,
            balanceCoins: walletForWager,
            minBetCoins: minBet,
          });
          outcome = { ok: false, message: MANUAL_WAGER_CLEAR_MESSAGE };
        }
      } else {
        appendLog({
          accountId,
          category: "rain",
          message: "Wager requirement detected; placing limbo bet",
          detail: outcome.message,
        });
        void reportRainWagerClearing({
          nickname: account.nickname,
          rainId: rain.rainId,
          poolCoins: rainAmount,
          siteMessage: outcome.message,
        });
        wagerClearAttempted = true;
        await placeLimboWagerBet(accountId, client, hub, account, rainAmount, account.nickname, rain.rainId);
        const retryReq = uuid();
        let retryOutcome = await joinOnce(hub, retryReq, rain.rainId, accountId);
        outcome = retryOutcome;
        let extraWagers = 0;
        while (
          !outcome.ok &&
          isWagerRejection(outcome.message) &&
          getAccount(accountId)?.limbo_wager_enabled &&
          extraWagers < 2
        ) {
          extraWagers++;
          appendLog({
            accountId,
            category: "rain",
            message: "Still need wager; repeating limbo at rain pool size",
            detail: `${rainAmount} coins · attempt ${extraWagers + 1}`,
          });
          await placeLimboWagerBet(accountId, client, hub, account, rainAmount, account.nickname, rain.rainId);
          const againReq = uuid();
          retryOutcome = await joinOnce(hub, againReq, rain.rainId, accountId);
          outcome = retryOutcome;
        }
      }
    } else if (!outcome.ok && isWagerRejection(outcome.message)) {
      appendLog({
        accountId,
        category: "rain",
        message: "Wager required but limbo wager is off for this account",
        detail: outcome.message,
      });
      outcome = {
        ok: false,
        message: "Wager required but limbo wager is off for this account — use `/limbo set on:true`",
      };
    }

    let balanceBeforeCoins: number | null = null;
    if (outcome.ok) {
      markRainJoined(accountId, rain.rainId);
      const balKey = rainBalanceKey(accountId, rain.rainId);
      for (let i = 0; i < 4; i++) {
        try {
          const bal = await readBalanceCoins(client);
          balanceBeforeCoins = bal;
          rainBalanceBeforeJoin.set(balKey, bal);
          break;
        } catch {
          await new Promise((r) => setTimeout(r, 400));
        }
      }
    }

    recordRainJoin({
      accountId,
      rainId: rain.rainId,
      amount: rainAmount,
      success: outcome.ok,
      reason: outcome.message,
      balanceBeforeCoins,
    });

    if (outcome.ok) {
      if (balanceBeforeCoins != null) {
        patchRainJoinBalanceBefore(accountId, rain.rainId, balanceBeforeCoins);
      }
      updateAccount(accountId, {
        status: "idle",
        last_error: null,
      });
      appendLog({ accountId, category: "rain", message: "Joined rain", detail: rain.rainId });
    } else {
      updateAccount(accountId, accountStatusForRainFailure(outcome.message));
      appendLog({
        accountId,
        category: "rain",
        message: "Rain join failed",
        detail: outcome.message,
      });
    }

    if (input.reportToDiscord !== false) {
      void reportRainOutcome({
        nickname: account.nickname,
        success: outcome.ok,
        message: outcome.message,
        rainId: rain.rainId,
        poolCoins: rainAmount,
        wagerClearAttempted,
      });
    }

    return { success: outcome.ok, reason: outcome.message, wagerClearAttempted };
  } catch (err) {
    const reason = err instanceof Error ? err.message : String(err);
    if (
      !isTransientNetworkError(err) &&
      shouldInvalidateRainCaptcha(reason) &&
      !/timed out|join timed out/i.test(reason)
    ) {
      clearRainCaptcha(rain.rainId);
    }
    recordRainJoin({ accountId, rainId: rain.rainId, amount: rainAmount, success: false, reason });
    updateAccount(accountId, accountStatusForRainFailure(reason));
    const headline = reason.split("\n")[0]!.trim().slice(0, 220);
    appendLog({
      accountId,
      category: "rain",
      message: `Rain join error: ${headline}`,
      detail: `${rain.rainId}\n${reason}`,
    });
    return { success: false, reason };
  }
}

async function joinOnce(
  hub: RoRushHub,
  reqId: string,
  rainId: string,
  accountId: number,
): Promise<{ ok: boolean; message: string }> {
  const captchaToken = await takeRainCaptchaToken(rainId, { forRainJoin: true, accountId });
  if (!captchaToken) {
    return {
      ok: false,
      message: "Captcha token missing — set CAPTCHA_API_KEY + CAPTCHA_PROVIDER=2captcha",
    };
  }
  const outcomePromise = new Promise<{ ok: boolean; message: string }>((resolve) => {
    const timeout = setTimeout(() => resolve({ ok: false, message: "Retry timed out" }), 60_000);
    const finish = (result: { ok: boolean; message: string }) => {
      clearTimeout(timeout);
      offOk();
      offFail();
      resolve(result);
    };
    const offOk = hub.on(SIGNALR.rain.receiveJoinSuccess, (p) => {
      if (!matchesJoinReqId(p, reqId)) return;
      finish({ ok: true, message: "Joined rain after wager" });
    });
    const offFail = hub.on(SIGNALR.rain.receiveFailure, (p) => {
      const payload = p as { reqId?: string; message?: string };
      if (!payload.reqId || payload.reqId !== reqId) return;
      finish({ ok: false, message: payload.message ?? "Retry failed" });
    });
    void hub.joinRain({ reqId, rainId, captchaToken }).catch((err) => {
      finish({
        ok: false,
        message: err instanceof Error ? err.message : String(err),
      });
    });
  });
  return outcomePromise;
}

export function parseLimboResult(
  payload: unknown,
  targetMultiplier?: number,
): { hit: boolean; crashMultiplier: number | null } {
  if (typeof payload === "string") {
    try {
      return parseLimboResult(JSON.parse(payload) as unknown, targetMultiplier);
    } catch {
      return { hit: false, crashMultiplier: null };
    }
  }
  if (!payload || typeof payload !== "object") return { hit: false, crashMultiplier: null };
  const p = payload as Record<string, unknown>;
  const crashMultiplier = readLimboMultiplierFromObject(p);
  let hit = readLimboIsWin(p);
  if (hit == null && crashMultiplier != null && targetMultiplier != null && targetMultiplier > 0) {
    hit = crashMultiplier >= targetMultiplier;
  }
  if (hit == null) hit = false;
  return { hit, crashMultiplier };
}

type LimboWagerOpts = {
  reasonLabel?: string;
  rainId?: string;
  /** Exact bet size (dashboard test, rain payout). */
  betCoinsOverride?: number;
  multiplierOverride?: number;
  /** Only wager balance gained since join — never touch pre-rain stack. */
  balanceBeforeRain?: number;
  /** One attempt below RoRush min bet (e.g. 2 coins when min is 5). */
  allowBelowMinOnce?: boolean;
};

async function applyManualWagerClearStop(input: {
  accountId: number;
  nickname: string;
  rainId: string;
  balanceCoins: number;
  minBetCoins: number;
}): Promise<void> {
  const row = getAccount(input.accountId);
  const wasAuto =
    row != null &&
    (Number(row.limbo_wager_enabled) !== 0 || Number(row.pre_wager_before_rain) !== 0);
  updateAccount(input.accountId, {
    limbo_wager_enabled: 0,
    pre_wager_before_rain: 0,
    status: "idle",
    last_error: MANUAL_WAGER_CLEAR_MESSAGE,
  });
  appendLog({
    accountId: input.accountId,
    category: "rain",
    message: "Auto limbo disabled — manual wager clear",
    detail: `${input.balanceCoins.toFixed(2)} coins wallet · need ${input.minBetCoins.toFixed(2)} min limbo bet`,
  });
  if (wasAuto) {
    void reportRainManualWagerClearRequired({
      nickname: input.nickname,
      rainId: input.rainId,
      balanceCoins: input.balanceCoins,
      minBetCoins: input.minBetCoins,
    });
  }
}

async function placeLimboWagerBet(
  accountId: number,
  client: import("../rorush/http-client.js").RoRushHttpClient,
  hub: RoRushHub,
  account: { limbo_multiplier: number; limbo_bet_coins: number; nickname: string },
  rainAmountCoins: number,
  nickname: string,
  rainId: string,
  opts: LimboWagerOpts = {},
): Promise<{ betCoins: number; hit: boolean }> {
  await ensureAuthenticated(accountId);
  const reqId = uuid();
  const minBetCoins = effectiveLimboMinBetCoins();
  const envBetCents = Number(process.env.LIMBO_MIN_BET_CENTS ?? NaN);
  const envMultCents = Number(process.env.LIMBO_MIN_MULTIPLIER_CENTS ?? NaN);
  const envMaxBet = Number(process.env.LIMBO_MAX_BET_COINS ?? NaN);
  let mult =
    opts.multiplierOverride != null && Number.isFinite(opts.multiplierOverride)
      ? opts.multiplierOverride
      : Number.isFinite(envMultCents)
        ? envMultCents / 100
        : account.limbo_multiplier;
  mult = Math.max(LIMBO_MIN_MULTIPLIER, mult);

  const balanceBeforeBet = await readBalanceCoins(client);
  let betCoins: number;
  /** Wager full rain payout / pool slice — do not apply the 2% wallet headroom. */
  const wagerFullRainAmount =
    opts.balanceBeforeRain != null || (rainAmountCoins > 0 && opts.betCoinsOverride == null);
  const balanceCap = (amount: number) =>
    wagerFullRainAmount
      ? Math.min(amount, balanceBeforeBet)
      : Math.min(amount, balanceBeforeBet * 0.98);

  if (opts.betCoinsOverride != null && Number.isFinite(opts.betCoinsOverride)) {
    betCoins = opts.betCoinsOverride;
    if (opts.balanceBeforeRain != null) {
      const rainOnlyCap = Math.max(0, balanceBeforeBet - opts.balanceBeforeRain);
      betCoins = Math.min(betCoins, rainOnlyCap);
    }
  } else {
    let targetBet =
      rainAmountCoins > 0
        ? rainAmountCoins
        : Number.isFinite(envBetCents)
          ? envBetCents / 100
          : account.limbo_bet_coins;
    if (Number.isFinite(envMaxBet)) targetBet = Math.min(targetBet, envMaxBet);
    betCoins = balanceCap(targetBet);
  }

  if (Number.isFinite(envMaxBet)) betCoins = Math.min(betCoins, envMaxBet);
  betCoins = balanceCap(betCoins);

  if (opts.allowBelowMinOnce) {
    if (betCoins < 0.01) {
      throw new Error(
        `Limbo skipped — balance ${balanceBeforeBet.toFixed(2)} coins is too low for any limbo attempt`,
      );
    }
  } else if (opts.balanceBeforeRain != null) {
    if (betCoins < minBetCoins) {
      throw new Error(
        `Limbo skipped — rain profit ${betCoins.toFixed(2)} coins is below RoRush limbo minimum ${minBetCoins.toFixed(2)}`,
      );
    }
  } else if (betCoins < minBetCoins) {
    if (balanceBeforeBet >= minBetCoins) {
      betCoins = Math.min(minBetCoins, balanceBeforeBet * 0.98);
    } else {
      throw new Error(
        `Limbo skipped — balance ${balanceBeforeBet.toFixed(2)} coins, need at least ${minBetCoins.toFixed(2)} for limbo`,
      );
    }
  }

  const reasonLabel = opts.reasonLabel ?? "Limbo wager for rain requirement";
  const rainIdForReport = opts.rainId ?? rainId;

  const amountCents = Math.max(1, Math.round(betCoins * 100));
  const multiplierCents = Math.max(Math.round(LIMBO_MIN_MULTIPLIER * 100), Math.round(mult * 100));

  const balanceDetail = (before: number, after: number | null) =>
    `balance ${before.toFixed(2)} → ${after != null ? after.toFixed(2) : "…"} coins`;

  appendLog({
    accountId,
    category: "limbo",
    message: reasonLabel,
    detail: `${(amountCents / 100).toFixed(2)} coins @ ${(multiplierCents / 100).toFixed(2)}x · ${balanceDetail(balanceBeforeBet, null)}`,
  });

  const resultEvents = [SIGNALR.limbo.receiveResult, SIGNALR.limbo.receiveResultAlt];

  let hit = false;
  await new Promise<void>((resolve, reject) => {
    const timeoutMs = Number(process.env.LIMBO_RESULT_TIMEOUT_MS ?? 45_000);
    const timeout = setTimeout(() => reject(new Error("Limbo bet timed out")), timeoutMs);

    const cleanups: Array<() => void> = [];
    let settled = false;
    const limboDebug = /^(1|true|yes|on)$/i.test(process.env.LIMBO_DEBUG?.trim() ?? "");

    const finishOk = (raw: unknown) => {
      if (settled) return;
      if (!limboResultMatchesReqId(raw, reqId)) return;
      settled = true;
      clearTimeout(timeout);
      for (const c of cleanups) c();
      const betDisplay = amountCents / 100;
      const targetMult = multiplierCents / 100;
      const parsed = parseLimboResult(raw, targetMult);
      hit = parsed.hit;
      if (limboDebug) {
        console.log(
          "[limbo] result payload",
          typeof raw === "string" ? raw.slice(0, 400) : JSON.stringify(raw).slice(0, 400),
        );
      }
      const resultMult =
        parsed.crashMultiplier != null ? `${parsed.crashMultiplier.toFixed(2)}×` : "—";
      const limboMessage = parsed.hit
        ? `Limbo win · result ${resultMult} · set ${targetMult.toFixed(2)}×`
        : `Limbo loss · result ${resultMult} · set ${targetMult.toFixed(2)}×`;
      void (async () => {
        let balanceAfterBet: number | null = null;
        try {
          balanceAfterBet = await readBalanceCoins(client);
        } catch {
          balanceAfterBet = null;
        }
        appendLog({
          accountId,
          category: "limbo",
          message: limboMessage,
          detail: `${betDisplay.toFixed(2)} coins @ ${targetMult.toFixed(2)}× · ${balanceDetail(balanceBeforeBet, balanceAfterBet)}`,
        });
        void reportLimboOutcome({
          nickname,
          hit: parsed.hit,
          betCoins: betDisplay,
          targetMultiplier: targetMult,
          crashMultiplier: parsed.crashMultiplier,
          rainId: rainIdForReport,
          balanceBefore: balanceBeforeBet,
          balanceAfter: balanceAfterBet,
          reasonLabel: reasonLabel,
        });
        resolve();
      })();
    };

    const finishFail = (p: unknown) => {
      clearTimeout(timeout);
      for (const c of cleanups) c();
      reject(new Error((p as { message?: string }).message ?? "Limbo failed"));
    };

    for (const ev of resultEvents) {
      cleanups.push(hub.on(ev, finishOk));
    }
    cleanups.push(hub.on(SIGNALR.limbo.receiveFailure, finishFail));

    void hub
      .playLimbo({
        reqId,
        amount: amountCents,
        currency: "CRYPTO",
        multiplier: multiplierCents,
      })
      .catch((err) => {
        clearTimeout(timeout);
        for (const c of cleanups) c();
        reject(err instanceof Error ? err : new Error(String(err)));
      });
  });

  return { betCoins, hit };
}

/** Optional small limbo before join window to satisfy wager gates early. */
export async function runPreRainWagerIfEnabled(input: {
  accountId: number;
  rain: RainState;
  hubs: HubRegistry;
}): Promise<void> {
  const { accountId, rain, hubs } = input;
  const { account, client } = await ensureAuthenticated(accountId);
  if (!account.pre_wager_before_rain || !account.limbo_wager_enabled) return;
  const bet = Math.max(effectiveLimboMinBetCoins(), account.limbo_bet_coins);
  appendLog({
    accountId,
    category: "limbo",
    message: "Pre-rain wager",
    detail: `${bet.toFixed(2)} coins before join · ${rain.rainId.slice(0, 8)}…`,
  });
  await placeLimboWagerBet(accountId, client, await hubs.ensure(accountId, { rain: true, cases: true }), account, rain.amount ?? 0, account.nickname, rain.rainId, {
    betCoinsOverride: bet,
    reasonLabel: "Pre-rain wager (optional)",
  });
}

/** Dashboard / manual test — does not use rain-only caps unless you pass balanceBeforeRain. */
export async function runTestLimboBet(input: {
  accountId: number;
  betCoins: number;
  multiplier?: number;
  hubs: HubRegistry;
}): Promise<{ betCoins: number; hit: boolean }> {
  const { accountId, betCoins, multiplier, hubs } = input;
  const minBet = effectiveLimboMinBetCoins();
  if (!Number.isFinite(betCoins) || betCoins < minBet) {
    throw new Error(`Bet must be at least ${minBet.toFixed(2)} coins on limbo`);
  }
  const { account, client } = await ensureAuthenticated(accountId);
  const hub = await hubs.ensure(accountId, { rain: true, cases: true });
  return placeLimboWagerBet(accountId, client, hub, account, 0, account.nickname, "test-limbo", {
    betCoinsOverride: betCoins,
    multiplierOverride: multiplier,
    reasonLabel: "Test limbo (dashboard)",
    rainId: "test-limbo",
  });
}

/** After rain pays out: credit lifetime earnings + optional limbo wager (every rain when enabled). */
export async function settleRainForAccount(input: {
  accountId: number;
  rainId: string;
  poolCoins?: number;
  hubs: HubRegistry;
}): Promise<void> {
  const { accountId, rainId, poolCoins, hubs } = input;
  const settleKey = accountRainSettleKey(accountId, rainId);
  if (accountRainSettled.has(settleKey)) return;
  accountRainSettled.add(settleKey);

  const { account, client } = await ensureAuthenticated(accountId);
  if (!isRainJoined(accountId, rainId)) {
    accountRainSettled.delete(settleKey);
    return;
  }

  const key = rainBalanceKey(accountId, rainId);
  const before =
    rainBalanceBeforeJoin.get(key) ?? getRainJoinBalanceBefore(accountId, rainId);
  const { after, earned } = await measureRainPayoutCoins(client, before);
  rainBalanceBeforeJoin.delete(key);

  if (earned != null && earned >= 0.01) {
    updateAccount(accountId, {
      lifetime_rain: account.lifetime_rain + earned,
      balance: after,
    });
    appendLog({
      accountId,
      category: "rain",
      message: "Rain payout recorded",
      detail: `+${earned.toFixed(2)} coins (not pool size)`,
    });
  } else {
    updateAccount(accountId, { balance: after });
  }

  const runVaultStep = async (): Promise<void> => {
    const fresh = getAccount(accountId);
    if (!fresh) return;
    const { vaultRainCycleProfits } = await import("./vault-after-rain.js");
    await vaultRainCycleProfits({
      account: fresh,
      client,
      balanceBeforeRain: before,
      rainId,
    });
  };

  if (!account.limbo_wager_enabled) {
    await runVaultStep();
    return;
  }

  const minBetAfterRain = effectiveLimboMinBetCoins();
  if (earned == null || before == null || earned < minBetAfterRain) {
    const why =
      before == null
        ? "No pre-join balance snapshot — enable Join rain before the window and keep dev running"
        : earned == null
          ? "Payout not on balance yet — limbo skipped (your stack was not wagered)"
          : `Payout ${earned.toFixed(2)} coins — below limbo minimum ${minBetAfterRain.toFixed(2)} (RoRush)`;
    appendLog({
      accountId,
      category: "limbo",
      message: "Limbo skipped after rain",
      detail: why,
    });
    await runVaultStep();
    return;
  }

  try {
    const hub = await hubs.ensure(accountId, { rain: true, cases: true });
    const freshBalance = await readBalanceCoins(client);
    const rainProfit =
      before != null ? Math.max(0, freshBalance - before) : earned ?? 0;
    const betRainProceeds = Math.max(earned ?? 0, rainProfit);
    await placeLimboWagerBet(accountId, client, hub, account, poolCoins ?? 0, account.nickname, rainId, {
      betCoinsOverride: betRainProceeds,
      balanceBeforeRain: before,
      reasonLabel: "Limbo wager (rain payout only)",
      rainId,
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    appendLog({
      accountId,
      category: "limbo",
      message: "Limbo wager failed",
      detail: msg,
    });
    updateAccount(accountId, { last_error: msg, status: "error" });
  }

  await runVaultStep();
}

const rainSettlementInflight = new Set<string>();
const accountRainSettled = new Set<string>();

function accountRainSettleKey(accountId: number, rainId: string): string {
  return `${accountId}:${rainId}`;
}

async function measureRainPayoutCoins(
  client: import("../rorush/http-client.js").RoRushHttpClient,
  before: number | null,
): Promise<{ after: number; earned: number | null }> {
  const maxWaitMs = Math.max(5_000, Number(process.env.RAIN_PAYOUT_WAIT_MS ?? 22_000) || 22_000);
  const pollMs = 2_000;
  const start = Date.now();
  let after = await readBalanceCoins(client);
  while (Date.now() - start < maxWaitMs) {
    if (before != null && after > before + 0.0001) {
      return { after, earned: after - before };
    }
    await new Promise((r) => setTimeout(r, pollMs));
    after = await readBalanceCoins(client);
  }
  if (before != null && after > before + 0.0001) {
    return { after, earned: after - before };
  }
  return { after, earned: null };
}

export async function settleRainForAllJoiners(input: {
  rainId: string;
  poolCoins?: number;
  hubs: HubRegistry;
}): Promise<void> {
  if (rainSettlementInflight.has(input.rainId)) return;
  rainSettlementInflight.add(input.rainId);
  try {
    await settleRainForAllJoinersInner(input);
  } finally {
    rainSettlementInflight.delete(input.rainId);
  }
}

async function settleRainForAllJoinersInner(input: {
  rainId: string;
  poolCoins?: number;
  hubs: HubRegistry;
}): Promise<void> {
  for (const accountId of accountIdsWithSuccessfulRainJoin(input.rainId)) {
    try {
      await settleRainForAccount({
        accountId,
        rainId: input.rainId,
        poolCoins: input.poolCoins,
        hubs: input.hubs,
      });
    } catch (err) {
      appendLog({
        accountId,
        category: "rain",
        message: "Rain settlement error",
        detail: err instanceof Error ? err.message : String(err),
      });
    }
  }
}

/** RoRush sends success as the reqId string; failures use `{ reqId, message }`. */
export function matchesJoinReqId(payload: unknown, reqId: string): boolean {
  if (typeof payload === "string") return payload === reqId;
  if (payload && typeof payload === "object") {
    const id = (payload as { reqId?: string }).reqId;
    return typeof id === "string" && id === reqId;
  }
  return false;
}

export function parseRain(payload: unknown): RainState | null {
  if (!payload || typeof payload !== "object") return null;
  const p = payload as Record<string, unknown>;
  const rainId = String(p.rainId ?? p.id ?? "");
  if (!rainId) return null;
  const amountRaw =
    typeof p.amount === "number"
      ? p.amount
      : typeof p.totalAmount === "number"
        ? p.totalAmount
        : typeof p.baseAmount === "number"
          ? p.baseAmount
          : undefined;
  const hasTipStage = typeof p.tipStageDuration === "number";
  const createdTimestamp =
    typeof p.createdTimestamp === "number"
      ? p.createdTimestamp
      : hasTipStage && typeof p.timestamp === "number"
        ? p.timestamp
        : undefined;
  let joinStageStartTimestamp: number | null =
    typeof p.joinStageStartTimestamp === "number" ? p.joinStageStartTimestamp : null;
  // ReceiveRainJoinStageStart uses `timestamp`, not joinStageStartTimestamp (see RoRush web client).
  if (
    joinStageStartTimestamp == null &&
    !hasTipStage &&
    typeof p.timestamp === "number" &&
    typeof p.joinStageDuration === "number"
  ) {
    joinStageStartTimestamp = p.timestamp;
  }
  const joinStageDuration =
    typeof p.joinStageDuration === "number"
      ? p.joinStageDuration
      : joinStageStartTimestamp != null
        ? 90_000
        : undefined;
  return {
    rainId,
    amount: amountRaw != null ? amountRaw / 100 : undefined,
    createdTimestamp,
    tipStageDuration: typeof p.tipStageDuration === "number" ? p.tipStageDuration : undefined,
    joinStageStartTimestamp,
    joinStageDuration,
  };
}

const DEFAULT_JOIN_STAGE_MS = 90_000;

export function rainJoinStageBounds(
  rain: RainState,
  now = Date.now(),
): { joinStart: number; joinEnd: number } | null {
  const joinDur = rain.joinStageDuration ?? DEFAULT_JOIN_STAGE_MS;
  let joinStart = rain.joinStageStartTimestamp ?? null;
  if (joinStart == null && rain.createdTimestamp != null && rain.tipStageDuration != null) {
    joinStart = rain.createdTimestamp + rain.tipStageDuration;
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

/** When to start paid 2Captcha tasks — shortly before join so tokens stay fresh. */
export function rainCaptchaSolveWindow(rain: RainState, now = Date.now()): boolean {
  if (rainJoinWindowOpen(rain, now)) return true;
  const bounds = rainJoinStageBounds(rain, now);
  if (!bounds || now > bounds.joinEnd) return false;
  const leadMs = Math.max(
    45_000,
    Number(process.env.CAPTCHA_SOLVE_START_LEAD_MS ?? 95_000) || 95_000,
  );
  const msUntilJoin = bounds.joinStart - now;
  return msUntilJoin > 0 && msUntilJoin <= leadMs;
}

/** Hub warm-up / listener prep — wider window than captcha solve. */
export function rainCaptchaPrewarmWindow(rain: RainState, now = Date.now()): boolean {
  if (rainJoinWindowOpen(rain, now)) return true;
  const bounds = rainJoinStageBounds(rain, now);
  const leadMs = Math.max(
    60_000,
    Number(process.env.RAIN_CAPTCHA_PREWARM_BEFORE_JOIN_MS ?? 180_000) || 180_000,
  );
  if (!bounds) {
    return !!(
      rain.createdTimestamp &&
      now >= rain.createdTimestamp &&
      now - rain.createdTimestamp < 45_000
    );
  }
  if (now > bounds.joinEnd) return false;
  if (now >= bounds.joinStart) return true;
  const msUntilJoin = bounds.joinStart - now;
  return msUntilJoin > 0 && msUntilJoin <= leadMs;
}

export function maxFailures(): number {
  return loadConfig().MAX_REQUEST_FAILURES;
}
