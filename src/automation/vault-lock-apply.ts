import { ensureAuthenticatedForVault } from "../accounts/session-manager.js";
import { appendLog, getAccount, updateAccount } from "../db/repositories.js";
import { formatVaultLockPreset } from "../rorush/vault-lock.js";
import { isVaultLockActive, lockVaultForMinutes } from "../rorush/vault.js";
import { expireVaultSessionIfNeeded } from "./vault-session.js";
import { engine } from "../worker/engine.js";

/** Turn off always-on rain vault + local timed vault session prefs (does not unlock RoRush early). */
export async function clearAllVaultPreferences(accountId: number): Promise<string> {
  const account = getAccount(accountId);
  if (!account) return "Account not found.";
  updateAccount(accountId, {
    auto_vault_deposit: 0,
    vault_lock_minutes: 0,
    vault_lock_expires_at: null,
    vault_session_auto_deposit: 0,
  });
  await engine.reloadAccounts();
  appendLog({
    accountId,
    category: "vault",
    message: "Vault automation cleared",
    detail: "Always-on rain vault and local lock session prefs off",
  });
  return (
    `**${account.nickname}** · All vault automation **OFF** on this host (always-on rain vault + local timer prefs).\n` +
    "If vault is still locked on **RoRush**, wait for the site timer — this does not unlock early."
  );
}

/** Start a timed vault lock from `/rorush vault` (optional rain→vault for that window only). */
export async function startVaultSession(input: {
  accountId: number;
  lockMinutes: number;
  vaultRainDuringLock: boolean;
}): Promise<string> {
  const account = getAccount(input.accountId);
  if (!account) return "Account not found.";
  if (input.lockMinutes <= 0) throw new Error("Invalid vault lock duration.");

  const { client, creds } = await ensureAuthenticatedForVault(account.id);
  const lock = await lockVaultForMinutes(client, input.lockMinutes, creds);
  const expires = lock.unlockAt;
  updateAccount(account.id, {
    vault_lock_minutes: input.lockMinutes,
    vault_session_auto_deposit: input.vaultRainDuringLock ? 1 : 0,
    vault_lock_expires_at: expires,
  });

  const label = formatVaultLockPreset(input.lockMinutes);
  appendLog({
    accountId: account.id,
    category: lock.confirmedOnRoRush ? "system" : "vault",
    message: lock.confirmedOnRoRush ? "Vault session started" : "Vault session started (RoRush timer unconfirmed)",
    detail: `${label} · until ${expires.slice(0, 19)}Z · rain vault ${input.vaultRainDuringLock ? "on" : "off"} · confirmed ${lock.confirmedOnRoRush ? "yes" : "no"}`,
  });

  const rainLine = input.vaultRainDuringLock
    ? "Rain profits **auto-move to vault** until the timer ends."
    : "Rain stays in your wallet (use **`/account vault on:true`** for always-on rain vault).";

  const until = expires.slice(11, 19);
  const lockLine = lock.confirmedOnRoRush
    ? `**${account.nickname}** · Vault locked **${label}** (withdraw blocked on RoRush until **${until} UTC**).`
    : [
        `**${account.nickname}** · Vault lock **${label}** could not be confirmed on RoRush (bot timer **${until} UTC** for rain-vault session only).`,
        "Deposits work but lock returned no site timer — open **rorush.com → Vault** while logged in as this account. If lock works there, paste browser **apiKey** (Local Storage) into **`/account session`** and retry **`/rorush vault`**.",
      ].join("\n");

  return [lockLine, rainLine, "When the timer expires, **nothing re-locks** — run **`/rorush vault`** again if you want another lock."].join(
    "\n",
  );
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
