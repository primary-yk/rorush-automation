import { ensureAuthenticated } from "../accounts/session-manager.js";
import { appendLog, getAccount, updateAccount } from "../db/repositories.js";
import { formatVaultLockPreset } from "../rorush/vault-lock.js";
import { isVaultLockActive, lockVaultForMinutes, vaultLockExpiresAtIso } from "../rorush/vault.js";
import { expireVaultSessionIfNeeded } from "./vault-session.js";

/** Start a timed vault lock from `/rorush vault` (optional rain→vault for that window only). */
export async function startVaultSession(input: {
  accountId: number;
  lockMinutes: number;
  vaultRainDuringLock: boolean;
}): Promise<string> {
  const account = getAccount(input.accountId);
  if (!account) return "Account not found.";
  if (input.lockMinutes <= 0) throw new Error("Invalid vault lock duration.");

  updateAccount(account.id, {
    vault_lock_minutes: input.lockMinutes,
    vault_session_auto_deposit: input.vaultRainDuringLock ? 1 : 0,
  });

  const { client } = await ensureAuthenticated(account.id);
  const lock = await lockVaultForMinutes(client, input.lockMinutes);
  const expires = lock.unlockAt;
  updateAccount(account.id, { vault_lock_expires_at: expires });

  const label = formatVaultLockPreset(input.lockMinutes);
  appendLog({
    accountId: account.id,
    category: "system",
    message: "Vault session started",
    detail: `${label} · until ${expires.slice(0, 19)}Z · rain vault ${input.vaultRainDuringLock ? "on" : "off"}`,
  });

  const rainLine = input.vaultRainDuringLock
    ? "Rain profits **auto-move to vault** until the timer ends."
    : "Rain stays in your wallet (use **`/account vault on:true`** for always-on rain vault).";

  return [
    `**${account.nickname}** · Vault locked **${label}** (withdraw blocked on RoRush until **${expires.slice(11, 19)} UTC**).`,
    rainLine,
    "When the timer expires, **nothing re-locks** — run **`/rorush vault`** again if you want another lock.",
  ].join("\n");
}

export function vaultLockStatusLine(account: {
  id: number;
  vault_lock_minutes: number;
  vault_lock_expires_at: string | null;
  vault_session_auto_deposit: number;
}): string | null {
  const row = expireVaultSessionIfNeeded(account.id) ?? account;
  if (!row.vault_lock_minutes || !isVaultLockActive(row.vault_lock_expires_at)) return null;
  const label = formatVaultLockPreset(row.vault_lock_minutes);
  const until = row.vault_lock_expires_at!.slice(11, 19);
  const rain =
    Number(row.vault_session_auto_deposit) !== 0 ? " · vaulting rain for session" : "";
  return `vault locked **${label}** until ${until} UTC${rain}`;
}
