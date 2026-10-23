import { readCurrentBalanceToken, type RorushBalanceToken } from "../rorush/balance-token.js";
import type { RoRushHttpClient } from "../rorush/http-client.js";

/** RoRush mines uses currency CRYPTO; wallet mode is balance token (coin vs funCoin). */
export type MinesWalletMode = RorushBalanceToken;

export function parseMinesWalletMode(raw: string | null | undefined): MinesWalletMode {
  const t = raw?.trim().toLowerCase();
  if (t === "funcoin" || t === "funcoins" || t === "fun" || t === "f" || t === "fun_coin") {
    return "funCoin";
  }
  return "coin";
}

export function minesWalletLabel(mode: MinesWalletMode): string {
  return mode === "funCoin" ? "FunCoins" : "Real coins";
}

export async function applyMinesWalletMode(
  client: RoRushHttpClient,
  mode: MinesWalletMode,
): Promise<void> {
  const current = await readCurrentBalanceToken(client).catch(() => null);
  if (current === mode) return;
  await client.setBalanceToken(mode);
}
