import { getAccount, updateAccount, type AccountRow } from "../db/repositories.js";
import { isVaultLockActive } from "../rorush/vault.js";

/** Clear timed vault session after RoRush timer expires (no auto re-lock). */
export function expireVaultSessionIfNeeded(accountId: number): AccountRow | undefined {
  const account = getAccount(accountId);
  if (!account) return undefined;
  if (!account.vault_lock_expires_at?.trim()) return account;
  if (isVaultLockActive(account.vault_lock_expires_at)) return account;
  updateAccount(accountId, {
    vault_lock_minutes: 0,
    vault_lock_expires_at: null,
    vault_session_auto_deposit: 0,
  });
  return getAccount(accountId);
}

/** Rain → vault during an active `/rorush vault` session, or legacy `/account vault on`. */
export function shouldAutoVaultRainProfit(account: AccountRow): boolean {
  const row = expireVaultSessionIfNeeded(account.id) ?? account;
  if (Number(row.auto_vault_deposit) !== 0) return true;
  if (Number(row.vault_session_auto_deposit) === 0) return false;
  return isVaultLockActive(row.vault_lock_expires_at);
}
