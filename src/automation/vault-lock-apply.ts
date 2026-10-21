import { ensureAuthenticated } from "../accounts/session-manager.js";
import { appendLog, getAccount, updateAccount } from "../db/repositories.js";
import { formatVaultLockPreset } from "../rorush/vault-lock.js";
import { isVaultLockActive, lockVaultForMinutes, vaultLockExpiresAtIso } from "../rorush/vault.js";

/** Apply or clear timed vault lock preference (Discord `/account vaultlock`). */
export async function applyVaultLockSetting(input: {
  accountId: number;
  lockMinutes: number;
}): Promise<string> {
  const account = getAccount(input.accountId);
  if (!account) return "Account not found.";

  if (input.lockMinutes <= 0) {
    updateAccount(account.id, {
      vault_lock_minutes: 0,
      vault_lock_expires_at: null,
    });
    return (
      `**${account.nickname}** · Vault timer **OFF** for future rains. ` +
      "This does not unlock vault early on RoRush — wait for the current timer there if one is active."
    );
  }

  updateAccount(account.id, {
    vault_lock_minutes: input.lockMinutes,
  });

  const { client } = await ensureAuthenticated(account.id);
  await lockVaultForMinutes(client, input.lockMinutes);
  const expires = vaultLockExpiresAtIso(input.lockMinutes);
  updateAccount(account.id, { vault_lock_expires_at: expires });

  appendLog({
    accountId: account.id,
    category: "system",
    message: "Vault timer set",
    detail: `${formatVaultLockPreset(input.lockMinutes)} · until ${expires.slice(0, 19)}Z`,
  });

  return (
    `**${account.nickname}** · Vault timer **${formatVaultLockPreset(input.lockMinutes)}** — ` +
    "withdraw blocked on RoRush until it expires. Rain profits still **deposit to vault** while locked."
  );
}

export function vaultLockStatusLine(account: {
  vault_lock_minutes: number;
  vault_lock_expires_at: string | null;
}): string | null {
  if (!account.vault_lock_minutes) return null;
  const label = formatVaultLockPreset(account.vault_lock_minutes);
  if (isVaultLockActive(account.vault_lock_expires_at)) {
    return `vault locked **${label}** until ${account.vault_lock_expires_at!.slice(11, 19)} UTC`;
  }
  return `vault timer **${label}** (re-locks after next vault deposit when expired)`;
}
