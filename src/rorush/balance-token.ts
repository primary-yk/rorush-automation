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

/** Real-coin rain joins fail while RoRush wallet is on FunCoins — force main wallet before join. */
export async function ensureRealCoinsWallet(
  client: RoRushHttpClient,
  log?: { accountId: number; nickname?: string },
): Promise<{ before: RorushBalanceToken | null; after: RorushBalanceToken | null }> {
  let before: RorushBalanceToken | null = null;
  try {
    before = parseCurrentBalanceToken(await client.authStatus());
  } catch {
    /* auth status shape varies — still attempt token:set */
  }

  await client.setBalanceToken("coin");

  let after: RorushBalanceToken | null = null;
  try {
    after = parseCurrentBalanceToken(await client.authStatus());
  } catch {
    after = "coin";
  }

  if (log && before === "funCoin") {
    appendLog({
      accountId: log.accountId,
      category: "rain",
      message: "Switched RoRush wallet FunCoins → real coins for rain",
      detail: log.nickname ?? `account ${log.accountId}`,
    });
  }

  return { before, after };
}
