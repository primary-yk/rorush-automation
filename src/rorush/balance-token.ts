import { appendLog } from "../db/repositories.js";
import type { RoRushHttpClient } from "./http-client.js";

/** RoRush wallet mode (`currentBalanceToken` on session / auth status). */
export type RorushBalanceToken = "coin" | "funCoin";

export type FunCoinCorrectReason = "detected" | "permission_denied" | "periodic";

export function parseCurrentBalanceToken(body: unknown): RorushBalanceToken | null {
  if (!body || typeof body !== "object") return null;
  const seen = new Set<unknown>();
  const walk = (node: unknown): RorushBalanceToken | null => {
    if (!node || typeof node !== "object" || seen.has(node)) return null;
    seen.add(node);
    const record = node as Record<string, unknown>;
    for (const key of ["currentBalanceToken", "balanceToken"] as const) {
      const v = record[key];
      if (v === "coin" || v === "funCoin") return v;
    }
    for (const nested of ["userInfo", "value", "data", "result", "usingBalance"] as const) {
      const inner = record[nested];
      const fromInner = walk(inner);
      if (fromInner) return fromInner;
    }
    return null;
  };
  return walk(body);
}

export function formatWalletBalanceToken(token: string | null | undefined): string {
  if (token === "funCoin") return "FunCoins";
  if (token === "coin") return "Real coins";
  return "Unknown";
}

export function isFunCoinRainBlock(message: string): boolean {
  return /permission denied|fun\s*coins?|funcoins?|balance token|fun\s*coin\s*mode|switch.*real\s*coins?|convert to coins|not available.*fun/i.test(
    message,
  );
}

export function shouldCorrectFunCoinWallet(
  before: RorushBalanceToken | null,
  reason: FunCoinCorrectReason,
): boolean {
  if (before === "funCoin") return true;
  if (reason === "permission_denied" && before !== "coin") return true;
  return false;
}

async function readBalanceTokenFromRoRush(client: RoRushHttpClient): Promise<RorushBalanceToken | null> {
  try {
    const fromAuth = parseCurrentBalanceToken(await client.authStatus());
    if (fromAuth) return fromAuth;
  } catch {
    /* try stats next */
  }
  try {
    return parseCurrentBalanceToken(await client.getStats());
  } catch {
    return null;
  }
}

export async function readCurrentBalanceToken(
  client: RoRushHttpClient,
): Promise<RorushBalanceToken | null> {
  return readBalanceTokenFromRoRush(client);
}

/**
 * Switch to real coins when FunCoins is detected, or on rain permission-denied when
 * token is unknown (auth did not expose wallet mode).
 */
export async function correctFunCoinWalletIfNeeded(
  client: RoRushHttpClient,
  reason: FunCoinCorrectReason,
  log?: { accountId: number; nickname?: string },
): Promise<{ switched: boolean; before: RorushBalanceToken | null; after: RorushBalanceToken | null }> {
  const before = await readCurrentBalanceToken(client);
  if (!shouldCorrectFunCoinWallet(before, reason)) {
    return { switched: false, before, after: before };
  }

  await client.setBalanceToken("coin");
  const after = (await readCurrentBalanceToken(client)) ?? "coin";

  if (log) {
    appendLog({
      accountId: log.accountId,
      category: "rain",
      message: "Detected FunCoins wallet — switched back to real coins",
      detail:
        (log.nickname ?? `account ${log.accountId}`) +
        (before == null ? " · site blocked rain (token was unknown)" : ""),
    });
  }

  return { switched: true, before, after };
}

/** @deprecated Use correctFunCoinWalletIfNeeded */
export async function switchFromFunCoinsIfNeeded(
  client: RoRushHttpClient,
  log?: { accountId: number; nickname?: string },
): Promise<{ switched: boolean; before: RorushBalanceToken | null; after: RorushBalanceToken | null }> {
  return correctFunCoinWalletIfNeeded(client, "detected", log);
}
