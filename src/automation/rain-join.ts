import { v4 as uuid } from "uuid";
import { solveCaptcha } from "../captcha/capmonster.js";
import { loadConfig } from "../config.js";
import { appendLog, recordRainJoin, updateAccount } from "../db/repositories.js";
import { RoRushHub } from "../rorush/signalr-hub.js";
import type { RainState } from "../rorush/types.js";
import { ensureAuthenticated } from "../accounts/session-manager.js";

const WAGER_HINT =
  /wager|play.?through|recent|activity|requirement|bet/i;

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
  const { account, client, creds } = await ensureAuthenticated(accountId);

  if (!account.join_rain) {
    return { success: false, reason: "Join rain disabled for account" };
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
        resolve({ ok: false, message: "Rain join timed out" });
      }, 30_000);

      const onSuccess = (payload: unknown) => {
        const p = payload as { reqId?: string };
        if (p.reqId && p.reqId !== reqId) return;
        cleanup();
        resolve({ ok: true, message: "Joined rain" });
      };
      const onFailure = (payload: unknown) => {
        const p = payload as { reqId?: string; message?: string };
        if (p.reqId && p.reqId !== reqId) return;
        cleanup();
        resolve({ ok: false, message: p.message ?? "Rain join failed" });
      };

      const offOk = hub.on("ReceiveJoinRainSuccess", onSuccess);
      const offFail = hub.on("ReceiveRainFailure", onFailure);

      const cleanup = () => {
        clearTimeout(timeout);
        offOk();
        offFail();
      };
    });

  try {
    if (!captchaToken) {
      captchaToken = await solveCaptcha("hcaptcha");
    }
    await hub.joinRain({ reqId, rainId: rain.rainId, captchaToken });
    let outcome = await waitForOutcome();

    if (!outcome.ok && isWagerRejection(outcome.message) && account.limbo_wager_enabled) {
      appendLog({
        accountId,
        category: "rain",
        message: "Wager requirement detected; placing limbo bet",
        detail: outcome.message,
      });
      await placeMinLimboBet(accountId, client, hub, account);
      const retryReq = uuid();
      const retryOutcome = await joinOnce(hub, retryReq, rain.rainId, captchaToken);
      outcome = retryOutcome;
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
      updateAccount(accountId, {
        status: "idle",
        last_error: null,
        lifetime_rain: account.lifetime_rain + rainAmount,
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

    return { success: outcome.ok, reason: outcome.message };
  } catch (err) {
    const reason = err instanceof Error ? err.message : String(err);
    recordRainJoin({ accountId, rainId: rain.rainId, amount: rainAmount, success: false, reason });
    updateAccount(accountId, { status: "error", last_error: reason });
    appendLog({ accountId, category: "rain", message: "Rain join error", detail: reason });
    return { success: false, reason };
  }
}

async function joinOnce(
  hub: RoRushHub,
  reqId: string,
  rainId: string,
  captchaToken: string | null,
): Promise<{ ok: boolean; message: string }> {
  await hub.joinRain({ reqId, rainId, captchaToken });
  return new Promise((resolve) => {
    const timeout = setTimeout(() => resolve({ ok: false, message: "Retry timed out" }), 30_000);
    const offOk = hub.on("ReceiveJoinRainSuccess", (p) => {
      const payload = p as { reqId?: string };
      if (payload.reqId !== reqId) return;
      clearTimeout(timeout);
      offOk();
      offFail();
      resolve({ ok: true, message: "Joined rain after wager" });
    });
    const offFail = hub.on("ReceiveRainFailure", (p) => {
      const payload = p as { reqId?: string; message?: string };
      if (payload.reqId && payload.reqId !== reqId) return;
      clearTimeout(timeout);
      offOk();
      offFail();
      resolve({ ok: false, message: payload.message ?? "Retry failed" });
    });
  });
}

async function placeMinLimboBet(
  accountId: number,
  client: import("../rorush/http-client.js").RoRushHttpClient,
  hub: RoRushHub,
  account: { limbo_multiplier: number; limbo_bet_coins: number },
): Promise<void> {
  const { creds } = await ensureAuthenticated(accountId);
  const reqId = uuid();
  const envBetCents = Number(process.env.LIMBO_MIN_BET_CENTS ?? NaN);
  const envMultCents = Number(process.env.LIMBO_MIN_MULTIPLIER_CENTS ?? NaN);
  const betCoins = Number.isFinite(envBetCents) ? envBetCents / 100 : account.limbo_bet_coins;
  const mult = Number.isFinite(envMultCents) ? envMultCents / 100 : account.limbo_multiplier;
  const amountCents = Math.max(1, Math.round(betCoins * 100));
  const multiplierCents = Math.max(110, Math.round(mult * 100));

  await hub.playLimbo({
    reqId,
    amount: amountCents,
    currency: "CRYPTO",
    multiplier: multiplierCents,
  });

  await new Promise<void>((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error("Limbo bet timed out")), 20_000);
    const offOk = hub.on("ReceivePrivateLimboResult", () => {
      clearTimeout(timeout);
      offOk();
      offFail();
      resolve();
    });
    const offFail = hub.on("ReceiveLimboFailure", (p) => {
      clearTimeout(timeout);
      offOk();
      offFail();
      reject(new Error((p as { message?: string }).message ?? "Limbo failed"));
    });
  });

  await client.getBalance();
  void creds;
}

export function parseRain(payload: unknown): RainState | null {
  if (!payload || typeof payload !== "object") return null;
  const p = payload as Record<string, unknown>;
  const rainId = String(p.rainId ?? p.id ?? "");
  if (!rainId) return null;
  return {
    rainId,
    amount: typeof p.amount === "number" ? p.amount / 100 : undefined,
    createdTimestamp: typeof p.createdTimestamp === "number" ? p.createdTimestamp : undefined,
    tipStageDuration: typeof p.tipStageDuration === "number" ? p.tipStageDuration : undefined,
    joinStageStartTimestamp:
      typeof p.joinStageStartTimestamp === "number" ? p.joinStageStartTimestamp : null,
    joinStageDuration: typeof p.joinStageDuration === "number" ? p.joinStageDuration : undefined,
  };
}

export function rainJoinWindowOpen(rain: RainState, now = Date.now()): boolean {
  if (rain.joinStageStartTimestamp && rain.joinStageDuration) {
    const end = rain.joinStageStartTimestamp + rain.joinStageDuration;
    return now >= rain.joinStageStartTimestamp && now <= end;
  }
  if (rain.createdTimestamp && rain.tipStageDuration) {
    return now >= rain.createdTimestamp + rain.tipStageDuration;
  }
  return true;
}

export function maxFailures(): number {
  return loadConfig().MAX_REQUEST_FAILURES;
}
