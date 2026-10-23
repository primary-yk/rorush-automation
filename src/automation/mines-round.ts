import { randomUUID } from "node:crypto";
import { getManualMinesSession } from "./mines-manual-session.js";
import { appendLog } from "../db/repositories.js";
import { depositCoinsToVault } from "../rorush/vault.js";
import type { RoRushHttpClient } from "../rorush/http-client.js";
import type { RoRushHub } from "../rorush/signalr-hub.js";
import { SIGNALR } from "../rorush/endpoints.js";

export const MINES_GRID_SIZE = 25;

export type MinesRoundConfig = {
  accountId: number;
  nickname: string;
  betCoins: number;
  minesCount: number;
  targetMultiplier: number;
  randomTiles: boolean;
  rainId: string;
  vaultAfterCashout: boolean;
};

export type MinesRoundOutcome =
  | { ok: true; hit: boolean; multiplier: number; vaultedCoins: number | null }
  | { ok: false; reason: string };

type RevealPayload = {
  multiplier?: number;
  currentPayout?: number;
  isMine?: boolean;
  isFinished?: boolean;
  revealedTiles?: number[];
};

function parseReveal(body: unknown): RevealPayload {
  if (!body || typeof body !== "object") return {};
  return body as RevealPayload;
}

function waitForHubEvent(
  hub: RoRushHub,
  events: string[],
  timeoutMs: number,
  match?: (payload: unknown) => boolean,
): Promise<unknown> {
  return new Promise((resolve, reject) => {
    const cleanups: Array<() => void> = [];
    const timer = setTimeout(() => {
      for (const c of cleanups) c();
      reject(new Error("Mines action timed out"));
    }, timeoutMs);
    const finish = (payload: unknown) => {
      if (match && !match(payload)) return;
      clearTimeout(timer);
      for (const c of cleanups) c();
      resolve(payload);
    };
    for (const ev of events) {
      cleanups.push(hub.on(ev, finish));
    }
    cleanups.push(hub.on(SIGNALR.mines.receiveFailure, (p) => {
      clearTimeout(timer);
      for (const c of cleanups) c();
      const msg = (p as { message?: string })?.message ?? "Mines failed";
      reject(new Error(msg));
    }));
  });
}

async function readBalanceCoins(client: RoRushHttpClient): Promise<number> {
  const body = await client.getBalance("crypto");
  const { parseBalanceCents } = await import("../rorush/balance-level.js");
  const cents = parseBalanceCents(body);
  if (cents == null) throw new Error("Could not read balance");
  return cents / 100;
}

async function vaultMinesProfit(
  client: RoRushHttpClient,
  balanceBefore: number,
): Promise<number | null> {
  const after = await readBalanceCoins(client);
  const profit = Math.floor((after - balanceBefore) * 100) / 100;
  if (profit < 0.01) return null;
  await depositCoinsToVault(client, profit, "CRYPTO");
  return profit;
}

export async function startMinesRoundOnHub(input: {
  hub: RoRushHub;
  client: RoRushHttpClient;
  config: MinesRoundConfig;
  pickTile?: (revealed: Set<number>) => number | null | Promise<number | null>;
}): Promise<MinesRoundOutcome> {
  const { hub, client, config } = input;
  const minBet = 0.01;
  if (config.betCoins < minBet) {
    return { ok: false, reason: `Rain profit ${config.betCoins.toFixed(2)} below mines minimum ${minBet}` };
  }
  if (config.minesCount < 1 || config.minesCount > 24) {
    return { ok: false, reason: "Mines count must be 1–24" };
  }
  if (config.targetMultiplier < 1.01) {
    return { ok: false, reason: "Target multiplier must be at least 1.01×" };
  }

  const amountCents = Math.max(1, Math.round(config.betCoins * 100));
  const clientSeed = randomUUID();
  const startReqId = randomUUID();

  appendLog({
    accountId: config.accountId,
    category: "mines",
    message: "Mines round started",
    detail: `${config.betCoins.toFixed(2)} coins · ${config.minesCount} mines · target ${config.targetMultiplier.toFixed(2)}×`,
  });

  const balanceBeforeRound = await readBalanceCoins(client);

  await hub.startMinesGame({
    reqId: startReqId,
    amount: amountCents,
    minesCount: config.minesCount,
    currency: "CRYPTO",
    clientSeed,
  });

  await waitForHubEvent(hub, [SIGNALR.mines.receiveStartSuccess], 30_000);

  const revealed = new Set<number>();
  let lastMultiplier = 1;

  const revealOne = async (tile: number): Promise<"gem" | "mine" | "target"> => {
    const reqId = randomUUID();
    await hub.minesRevealTile({ reqId, tilePosition: tile });
    const raw = await waitForHubEvent(
      hub,
      [SIGNALR.mines.receiveRevealSuccess],
      45_000,
    );
    const p = parseReveal(raw);
    revealed.add(tile);
    const manual = getManualMinesSession(config.accountId);
    manual?.revealed.add(tile);
    if (p.revealedTiles?.length) {
      for (const t of p.revealedTiles) {
        revealed.add(t);
        manual?.revealed.add(t);
      }
    }
    if (p.isMine) return "mine";
    lastMultiplier = typeof p.multiplier === "number" ? p.multiplier : lastMultiplier;
    if (lastMultiplier >= config.targetMultiplier) return "target";
    if (p.isFinished) return lastMultiplier >= config.targetMultiplier ? "target" : "gem";
    return "gem";
  };

  try {
    if (config.randomTiles) {
      while (true) {
        const hidden = [...Array(MINES_GRID_SIZE).keys()].filter((i) => !revealed.has(i));
        if (hidden.length === 0) break;
        const tile = hidden[Math.floor(Math.random() * hidden.length)]!;
        const step = await revealOne(tile);
        if (step === "mine") {
          appendLog({
            accountId: config.accountId,
            category: "mines",
            message: "Mines loss (hit bomb)",
            detail: `rain ${config.rainId.slice(0, 8)} · ${lastMultiplier.toFixed(2)}× before bomb`,
          });
          return { ok: true, hit: false, multiplier: lastMultiplier, vaultedCoins: null };
        }
        if (step === "target") break;
      }
    } else if (input.pickTile) {
      while (lastMultiplier < config.targetMultiplier) {
        const tile = await input.pickTile(revealed);
        if (tile == null) {
          return { ok: false, reason: "Manual mines board closed before target" };
        }
        const step = await revealOne(tile);
        if (step === "mine") {
          appendLog({
            accountId: config.accountId,
            category: "mines",
            message: "Mines loss (hit bomb)",
            detail: `manual · ${lastMultiplier.toFixed(2)}×`,
          });
          return { ok: true, hit: false, multiplier: lastMultiplier, vaultedCoins: null };
        }
        if (step === "target") break;
      }
    } else {
      return { ok: false, reason: "Manual mines requires tile picker" };
    }

    const cashoutReqId = randomUUID();
    await hub.minesCashout(cashoutReqId);
    await waitForHubEvent(hub, [SIGNALR.mines.receiveCashoutSuccess], 30_000);

    let vaulted: number | null = null;
    if (config.vaultAfterCashout) {
      vaulted = await vaultMinesProfit(client, balanceBeforeRound);
    }

    appendLog({
      accountId: config.accountId,
      category: "mines",
      message: "Mines cashout",
      detail: `${lastMultiplier.toFixed(2)}× · vaulted ${vaulted != null ? vaulted.toFixed(2) : "0"} coins`,
    });

    return { ok: true, hit: true, multiplier: lastMultiplier, vaultedCoins: vaulted };
  } catch (err) {
    const reason = err instanceof Error ? err.message : String(err);
    appendLog({
      accountId: config.accountId,
      category: "mines",
      message: "Mines round failed",
      detail: reason,
    });
    return { ok: false, reason };
  }
}
