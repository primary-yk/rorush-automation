import { v4 as uuid } from "uuid";
import { solveCaptcha } from "../captcha/capmonster.js";
import { clearRainCaptcha, takeRainCaptchaToken } from "./rain-captcha.js";
import { loadConfig } from "../config.js";
import {
  isRainJoined,
  markRainJoined,
  trackJoinInflight,
} from "./rain-join-state.js";
import { LIMBO_MIN_MULTIPLIER } from "../config.js";
import {
  appendLog,
  recordRainJoin,
  updateAccount,
  accountIdsWithSuccessfulRainJoin,
} from "../db/repositories.js";
import { parseBalanceCents } from "../rorush/balance-level.js";
import type { HubRegistry } from "../worker/hub-registry.js";
import { SIGNALR } from "../rorush/endpoints.js";
import { RoRushHub } from "../rorush/signalr-hub.js";
import type { RainState } from "../rorush/types.js";
import { ensureAuthenticated } from "../accounts/session-manager.js";
import { reportLimboOutcome, reportRainOutcome } from "../discord/reporter.js";

const WAGER_HINT =
  /wager|play.?through|recent|activity|requirement|bet/i;

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
  if (typeof payload === "string") return payload;
  if (!payload || typeof payload !== "object") return undefined;
  const p = payload as Record<string, unknown>;
  const id = p.reqId ?? p.ReqId ?? p.requestId;
  return typeof id === "string" ? id : undefined;
}

function limboResultMatchesReqId(payload: unknown, reqId: string): boolean {
  const id = limboPayloadReqId(payload);
  if (id) return id === reqId;
  return true;
}

export function isWagerRejection(message: string): boolean {
  return WAGER_HINT.test(message);
}

export async function joinRainForAccount(input: {
  accountId: number;
  rain: RainState;
  hub: RoRushHub;
  captchaToken?: string | null;
}): Promise<{ success: boolean; reason: string }> {
  const { accountId, rain, hub } = input;
  if (isRainJoined(accountId, rain.rainId)) {
    return { success: true, reason: "Already joined this rain" };
  }
  return trackJoinInflight(accountId, rain.rainId, () =>
    joinRainForAccountOnce({ accountId, rain, hub, captchaToken: input.captchaToken }),
  );
}

async function joinRainForAccountOnce(input: {
  accountId: number;
  rain: RainState;
  hub: RoRushHub;
  captchaToken?: string | null;
}): Promise<{ success: boolean; reason: string }> {
  const { accountId, rain, hub } = input;
  const { account, client } = await ensureAuthenticated(accountId);

  if (!account.join_rain) {
    return { success: false, reason: "Join rain disabled for account" };
  }

  if (isRainJoined(accountId, rain.rainId)) {
    return { success: true, reason: "Already joined this rain" };
  }

  const rainAmount = rain.amount ?? 0;
  if (rainAmount < account.min_rain_amount) {
    return { success: false, reason: `Rain amount ${rainAmount} below filter` };
  }

  const reqId = uuid();
  let captchaToken = input.captchaToken ?? null;

  const waitForOutcome = (): Promise<{ ok: boolean; message: string }> =>
    new Promise((resolve) => {
      const timeout = setTimeout(() => {
        cleanup();
        resolve({
          ok: false,
          message:
            "Rain join timed out (no success/failure from RoRush — often captcha or joining too late in the window)",
        });
      }, 45_000);

      const onSuccess = (payload: unknown) => {
        if (!matchesJoinReqId(payload, reqId)) return;
        cleanup();
        resolve({ ok: true, message: "Joined rain" });
      };
      const onFailure = (payload: unknown) => {
        const p = payload as { reqId?: string; message?: string };
        if (!p.reqId || p.reqId !== reqId) return;
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
      captchaToken = await takeRainCaptchaToken(rain.rainId);
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
      detail: `${rain.rainId} · pool ${rainAmount} coins`,
    });
    const outcomePromise = waitForOutcome();
    await hub.joinRain({ reqId, rainId: rain.rainId, captchaToken });
    let outcome = await outcomePromise;

    if (!outcome.ok && isWagerRejection(outcome.message) && account.limbo_wager_enabled) {
      appendLog({
        accountId,
        category: "rain",
        message: "Wager requirement detected; placing limbo bet",
        detail: outcome.message,
      });
      await placeLimboWagerBet(accountId, client, hub, account, rainAmount, account.nickname, rain.rainId);
      const retryReq = uuid();
      let retryOutcome = await joinOnce(hub, retryReq, rain.rainId);
      outcome = retryOutcome;
      // Some rains need more than one rain-sized wager before join succeeds.
      let extraWagers = 0;
      while (
        !outcome.ok &&
        isWagerRejection(outcome.message) &&
        account.limbo_wager_enabled &&
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
        retryOutcome = await joinOnce(hub, againReq, rain.rainId);
        outcome = retryOutcome;
      }
    } else if (!outcome.ok && isWagerRejection(outcome.message)) {
      appendLog({
        accountId,
        category: "rain",
        message: "Wager required but limbo wager is off for this account",
        detail: outcome.message,
      });
    }

    recordRainJoin({
      accountId,
      rainId: rain.rainId,
      amount: rainAmount,
      success: outcome.ok,
      reason: outcome.message,
    });

    if (outcome.ok) {
      markRainJoined(accountId, rain.rainId);
      clearRainCaptcha(rain.rainId);
      try {
        const bal = await readBalanceCoins(client);
        rainBalanceBeforeJoin.set(rainBalanceKey(accountId, rain.rainId), bal);
      } catch {
        /* balance snapshot optional */
      }
      updateAccount(accountId, {
        status: "idle",
        last_error: null,
      });
      appendLog({ accountId, category: "rain", message: "Joined rain", detail: rain.rainId });
    } else {
      updateAccount(accountId, { status: "error", last_error: outcome.message });
      appendLog({
        accountId,
        category: "rain",
        message: "Rain join failed",
        detail: outcome.message,
      });
    }

    void reportRainOutcome({
      nickname: account.nickname,
      success: outcome.ok,
      message: outcome.message,
      rainId: rain.rainId,
      poolCoins: rainAmount,
    });

    return { success: outcome.ok, reason: outcome.message };
  } catch (err) {
    const reason = err instanceof Error ? err.message : String(err);
    clearRainCaptcha(rain.rainId);
    recordRainJoin({ accountId, rainId: rain.rainId, amount: rainAmount, success: false, reason });
    updateAccount(accountId, { status: "error", last_error: reason });
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
): Promise<{ ok: boolean; message: string }> {
  const captchaToken = await solveCaptcha("hcaptcha");
  if (!captchaToken) {
    return {
      ok: false,
      message: "Captcha token missing — set CAPMONSTER_API_KEY (and check CapMonster balance)",
    };
  }
  const outcomePromise = new Promise<{ ok: boolean; message: string }>((resolve) => {
    const timeout = setTimeout(() => resolve({ ok: false, message: "Retry timed out" }), 30_000);
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

function parseLimboResult(payload: unknown): { hit: boolean; crashMultiplier: number | null } {
  if (!payload || typeof payload !== "object") return { hit: false, crashMultiplier: null };
  const p = payload as Record<string, unknown>;
  const hit = p.isWin === true || p.isWin === 1;
  let crashMultiplier: number | null = null;
  if (typeof p.multiplier === "number") {
    crashMultiplier = p.multiplier > 100 ? p.multiplier / 100 : p.multiplier;
  } else if (typeof p.crashMultiplier === "number") {
    crashMultiplier =
      p.crashMultiplier > 100 ? p.crashMultiplier / 100 : p.crashMultiplier;
  }
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
};

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

  const balanceCoins = await readBalanceCoins(client);
  let betCoins: number;

  if (opts.betCoinsOverride != null && Number.isFinite(opts.betCoinsOverride)) {
    betCoins = opts.betCoinsOverride;
    if (opts.balanceBeforeRain != null) {
      const rainOnlyCap = Math.max(0, balanceCoins - opts.balanceBeforeRain);
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
    betCoins = Math.min(targetBet, balanceCoins * 0.98);
  }

  if (Number.isFinite(envMaxBet)) betCoins = Math.min(betCoins, envMaxBet);
  betCoins = Math.min(betCoins, balanceCoins * 0.98);

  if (betCoins < 0.01) {
    throw new Error(
      `Limbo skipped — balance ${balanceCoins.toFixed(2)} coins, need at least 0.01 to wager`,
    );
  }

  const reasonLabel = opts.reasonLabel ?? "Limbo wager for rain requirement";
  const rainIdForReport = opts.rainId ?? rainId;

  const amountCents = Math.max(1, Math.round(betCoins * 100));
  const multiplierCents = Math.max(Math.round(LIMBO_MIN_MULTIPLIER * 100), Math.round(mult * 100));

  appendLog({
    accountId,
    category: "limbo",
    message: reasonLabel,
    detail: `${(amountCents / 100).toFixed(2)} coins @ ${(multiplierCents / 100).toFixed(2)}x`,
  });

  const resultEvents = [SIGNALR.limbo.receiveResult, SIGNALR.limbo.receiveResultAlt];

  let hit = false;
  await new Promise<void>((resolve, reject) => {
    const timeoutMs = Number(process.env.LIMBO_RESULT_TIMEOUT_MS ?? 45_000);
    const timeout = setTimeout(() => reject(new Error("Limbo bet timed out")), timeoutMs);

    const cleanups: Array<() => void> = [];

    const finishOk = (raw: unknown) => {
      if (!limboResultMatchesReqId(raw, reqId)) return;
      clearTimeout(timeout);
      for (const c of cleanups) c();
      const parsed = parseLimboResult(raw);
      hit = parsed.hit;
      const betDisplay = amountCents / 100;
      const targetMult = multiplierCents / 100;
      const crash =
        parsed.crashMultiplier != null ? `${parsed.crashMultiplier.toFixed(2)}×` : "unknown";
      const limboMessage = parsed.hit
        ? `Limbo hit at ${crash} (target ${targetMult.toFixed(2)}×)`
        : `Limbo miss — crashed at ${crash} (target ${targetMult.toFixed(2)}×)`;
      appendLog({
        accountId,
        category: "limbo",
        message: limboMessage,
        detail: `${betDisplay.toFixed(2)} coins @ ${targetMult.toFixed(2)}×`,
      });
      void reportLimboOutcome({
        nickname,
        hit: parsed.hit,
        betCoins: betDisplay,
        targetMultiplier: targetMult,
        crashMultiplier: parsed.crashMultiplier,
        rainId: rainIdForReport,
      });
      resolve();
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

  await client.getBalance();
  return { betCoins, hit };
}

/** Dashboard / manual test — does not use rain-only caps unless you pass balanceBeforeRain. */
export async function runTestLimboBet(input: {
  accountId: number;
  betCoins: number;
  multiplier?: number;
  hubs: HubRegistry;
}): Promise<{ betCoins: number; hit: boolean }> {
  const { accountId, betCoins, multiplier, hubs } = input;
  if (!Number.isFinite(betCoins) || betCoins < 0.01) {
    throw new Error("Bet must be at least 0.01 coins");
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
  const { account, client } = await ensureAuthenticated(accountId);
  if (!isRainJoined(accountId, rainId)) return;

  await new Promise((r) => setTimeout(r, 2_500));
  const after = await readBalanceCoins(client);
  const key = rainBalanceKey(accountId, rainId);
  const before = rainBalanceBeforeJoin.get(key);
  rainBalanceBeforeJoin.delete(key);

  let earned: number | null = null;
  if (before != null && after > before + 0.0001) {
    earned = after - before;
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

  if (!account.limbo_wager_enabled) return;

  if (earned == null || before == null || earned < 0.01) {
    appendLog({
      accountId,
      category: "limbo",
      message: "Limbo skipped after rain",
      detail: "Could not measure rain payout — no wager (your existing balance is untouched)",
    });
    return;
  }

  try {
    const hub = await hubs.ensure(accountId, { rain: true, cases: true });
    await placeLimboWagerBet(accountId, client, hub, account, poolCoins ?? 0, account.nickname, rainId, {
      betCoinsOverride: earned,
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
}

export async function settleRainForAllJoiners(input: {
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

export function rainJoinWindowOpen(rain: RainState, now = Date.now()): boolean {
  const joinDur = rain.joinStageDuration ?? DEFAULT_JOIN_STAGE_MS;
  let joinStart = rain.joinStageStartTimestamp ?? null;
  if (joinStart == null && rain.createdTimestamp != null && rain.tipStageDuration != null) {
    joinStart = rain.createdTimestamp + rain.tipStageDuration;
  }
  if (joinStart != null) {
    const end = joinStart + joinDur;
    return now >= joinStart && now <= end;
  }
  return false;
}

export function maxFailures(): number {
  return loadConfig().MAX_REQUEST_FAILURES;
}
