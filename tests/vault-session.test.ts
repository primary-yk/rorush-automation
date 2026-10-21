import { describe, expect, it, beforeEach } from "vitest";
import { getDb } from "../src/db/database.js";
import { getAccount, insertAccount, updateAccount } from "../src/db/repositories.js";
import {
  expireVaultSessionIfNeeded,
  shouldAutoVaultRainProfit,
} from "../src/automation/vault-session.js";
import { vaultLockExpiresAtIso } from "../src/rorush/vault.js";

describe("vault session", () => {
  beforeEach(() => {
    getDb().exec("DELETE FROM accounts");
  });

  it("clears expired session without re-lock preference", () => {
    const account = insertAccount({ nickname: "Main" });
    const past = "2000-01-01T00:00:00.000Z";
    updateAccount(account.id, {
      vault_lock_minutes: 60,
      vault_lock_expires_at: past,
      vault_session_auto_deposit: 1,
    });
    expireVaultSessionIfNeeded(account.id);
    const row = getAccount(account.id)!;
    expect(row.vault_lock_minutes).toBe(0);
    expect(row.vault_lock_expires_at).toBeNull();
    expect(row.vault_session_auto_deposit).toBe(0);
  });

  it("vaults rain when always-on or active session flag", () => {
    const account = insertAccount({ nickname: "A" });
    updateAccount(account.id, { auto_vault_deposit: 1 });
    expect(shouldAutoVaultRainProfit(getAccount(account.id)!)).toBe(true);

    updateAccount(account.id, { auto_vault_deposit: 0, vault_session_auto_deposit: 1 });
    const future = vaultLockExpiresAtIso(10, Date.now());
    updateAccount(account.id, { vault_lock_minutes: 10, vault_lock_expires_at: future });
    expect(shouldAutoVaultRainProfit(getAccount(account.id)!)).toBe(true);

    updateAccount(account.id, { vault_session_auto_deposit: 0 });
    expect(shouldAutoVaultRainProfit(getAccount(account.id)!)).toBe(false);
  });
});
