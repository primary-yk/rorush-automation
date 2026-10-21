import { appendLog, updateAccount } from "../db/repositories.js";
import type { AccountRow } from "../db/repositories.js";
import {
  depositCoinsToVault,
  isVaultLockActive,
  lockVaultForMinutes,
  vaultLockExpiresAtIso,
} from "../rorush/vault.js";
import { formatVaultLockPreset } from "../rorush/vault-lock.js";
import type { RoRushHttpClient } from "../rorush/http-client.js";
import { parseBalanceCents } from "../rorush/balance-level.js";

async function readBalanceCoins(client: RoRushHttpClient): Promise<number> {
  const body = await client.getBalance("crypto");
  const cents = parseBalanceCents(body);
  if (cents == null) throw new Error("Could not read wallet balance");
  return cents / 100;
}

/** Move rain + post-rain limbo profit into RoRush vault (keeps pre-rain wallet stack). */
export async function vaultRainCycleProfits(input: {
  account: AccountRow;
  client: RoRushHttpClient;
  balanceBeforeRain: number | null;
  rainId: string;
}): Promise<{ deposited: number | null; reason?: string }> {
  if (!input.account.auto_vault_deposit) {
    return { deposited: null, reason: "auto vault off" };
  }
  if (input.balanceBeforeRain == null) {
    return { deposited: null, reason: "no pre-rain balance snapshot" };
  }

  const wallet = await readBalanceCoins(input.client);
  const profit = wallet - input.balanceBeforeRain;
  if (profit < 0.01) {
    return { deposited: null, reason: `profit ${profit.toFixed(2)} coins below minimum` };
  }

  const depositCoins = Math.floor(profit * 100) / 100;
  const lockMinutes = input.account.vault_lock_minutes ?? 0;
  const lockActive = isVaultLockActive(input.account.vault_lock_expires_at);
  try {
    await depositCoinsToVault(input.client, depositCoins, "CRYPTO");
    if (lockMinutes > 0 && !lockActive) {
      await lockVaultForMinutes(input.client, lockMinutes);
      updateAccount(input.account.id, {
        vault_lock_expires_at: vaultLockExpiresAtIso(lockMinutes),
      });
      appendLog({
        accountId: input.account.id,
        category: "rain",
        message: "Vault timer started",
        detail: `Locked for ${formatVaultLockPreset(lockMinutes)} (withdraw blocked on RoRush; deposits still allowed)`,
      });
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    appendLog({
      accountId: input.account.id,
      category: "system",
      message: "Vault deposit failed",
      detail: `${depositCoins.toFixed(2)} coins · ${msg}`,
    });
    return { deposited: null, reason: msg };
  }

  appendLog({
    accountId: input.account.id,
    category: "rain",
    message: "Moved rain profit to vault",
    detail: `${depositCoins.toFixed(2)} coins · rain ${input.rainId.slice(0, 8)}…`,
  });
  return { deposited: depositCoins };
}
