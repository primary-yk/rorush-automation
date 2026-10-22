import { appendLog } from "../db/repositories.js";
import type { RoRushHttpClient } from "./http-client.js";

/** RoRush wallet mode (`currentBalanceToken` on session / auth status). */
export type RorushBalanceToken = "coin" | "funCoin";

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
    for (const nested of ["userInfo", "value", "data", "result"] as const) {
      const inner = record[nested];
      const fromInner = walk(inner);
      if (fromInner) return fromInner;
    }
    return null;
  };
  return walk(body);
}

export function isFunCoinRainBlock(message: string): boolean {
  return /permission denied|fun\s*coins?|funcoins?|balance token|fun\s*coin\s*mode|switch.*real\s*coins?|convert to coins|not available.*fun/i.test(
    message,
  );
}

export async function readCurrentBalanceToken(
  client: RoRushHttpClient,
): Promise<RorushBalanceToken | null> {
  try {
    return parseCurrentBalanceToken(await client.authStatus());
  } catch {
    return null;
  }
}

/** Switch to real coins only when RoRush reports the wallet is on FunCoins. */
export async function switchFromFunCoinsIfNeeded(
  client: RoRushHttpClient,
  log?: { accountId: number; nickname?: string },
): Promise<{ switched: boolean; before: RorushBalanceToken | null; after: RorushBalanceToken | null }> {
  const before = await readCurrentBalanceToken(client);
  if (before !== "funCoin") {
    return { switched: false, before, after: before };
  }

  await client.setBalanceToken("coin");
  const after = (await readCurrentBalanceToken(client)) ?? "coin";

  if (log) {
    appendLog({
      accountId: log.accountId,
      category: "rain",
      message: "Detected FunCoins wallet — switched back to real coins for rain",
      detail: log.nickname ?? `account ${log.accountId}`,
    });
  }

  return { switched: true, before, after };
}

/** @deprecated Use switchFromFunCoinsIfNeeded */
export const ensureRealCoinsWallet = switchFromFunCoinsIfNeeded;
