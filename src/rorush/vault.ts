import { parseBalanceCents } from "./balance-level.js";
import type { RoRushHttpClient } from "./http-client.js";
import { RORUSH_PATHS } from "./endpoints.js";
import { vaultLockApiDurationFromMinutes } from "./vault-lock.js";
import {
  extractRoRushErrorMessage,
  isBareBalanceCentsBody,
  parseVaultUnlockAt,
} from "./vault-unlock.js";

export type VaultCurrency = "CRYPTO" | "ROBUX";

/** RoRush vault deposit (wallet → vault). Amount is in coins; API uses cents like limbo. */
export async function depositCoinsToVault(
  client: RoRushHttpClient,
  amountCoins: number,
  currency: VaultCurrency = "CRYPTO",
): Promise<void> {
  if (!Number.isFinite(amountCoins) || amountCoins < 0.01) {
    throw new Error("Vault deposit must be at least 0.01 coins");
  }
  const amountCents = Math.max(1, Math.round(amountCoins * 100));
  await client.request(RORUSH_PATHS.vault.deposit, {
    method: "POST",
    body: JSON.stringify({ amount: amountCents, currency }),
  });
}

export type VaultLockResult = {
  unlockAt: string;
};

/** Timed vault lock — withdraw blocked on RoRush until duration elapses; deposits still allowed. */
export async function lockVaultForMinutes(
  client: RoRushHttpClient,
  minutes: number,
): Promise<VaultLockResult> {
  if (!Number.isFinite(minutes) || minutes < 1) {
    throw new Error("Vault lock duration must be at least 1 minute");
  }
  const duration = vaultLockApiDurationFromMinutes(minutes);
  if (!duration) {
    throw new Error(
      "Unsupported vault lock duration. Use 10m, 30m, 1h, 6h, 12h, or 1d (same as rorush.com).",
    );
  }
  const beforeUnlock = await fetchVaultUnlockAt(client);
  const vaultBal = await fetchVaultBalanceCoins(client);

  const data = await client.request<unknown>(RORUSH_PATHS.vault.lock, {
    method: "POST",
    body: JSON.stringify({ duration }),
  });

  const apiMsg = extractRoRushErrorMessage(data);
  if (apiMsg && !parseVaultUnlockAt(data)) {
    throw new Error(`RoRush vault lock: ${apiMsg}`);
  }

  let unlockAt = parseVaultUnlockAt(data);
  if (!unlockAt) {
    await new Promise((r) => setTimeout(r, 450));
    unlockAt = await fetchVaultUnlockAt(client);
  }
  if (!unlockAt || !isVaultLockActive(unlockAt)) {
    const afterUnlock = unlockAt ?? (await fetchVaultUnlockAt(client));
    if (afterUnlock && isVaultLockActive(afterUnlock)) {
      return { unlockAt: afterUnlock };
    }
    if (beforeUnlock && isVaultLockActive(beforeUnlock)) {
      const until = beforeUnlock.slice(11, 19);
      throw new Error(
        `Vault is already locked on RoRush until ${until} UTC. Wait for that timer, or unlock on the site, then run /rorush vault again.`,
      );
    }
    const emptyHint =
      vaultBal == null || vaultBal < 0.01
        ? " Your vault balance is 0 — on rorush.com deposit a small amount to vault, then try lock in the UI once."
        : "";
    throw new Error(
      "RoRush did not confirm a vault lock (no unlock timer returned)." +
        emptyHint +
        " Email/password accounts are fine — the bot logs in the same way. If lock works on the site for this account, run: npm run test-vault-lock -- --nick YOURNAME --verbose --lock 10m",
    );
  }
  return { unlockAt };
}

export async function fetchVaultUnlockAt(
  client: RoRushHttpClient,
  currency: VaultCurrency = "CRYPTO",
): Promise<string | null> {
  const paths = [
    RORUSH_PATHS.vault.info,
    `${RORUSH_PATHS.vault.info}?currency=${currency.toLowerCase()}`,
  ];
  for (const path of paths) {
    try {
      const info = await client.request<unknown>(path);
      if (isBareBalanceCentsBody(info)) continue;
      const unlockAt = parseVaultUnlockAt(info);
      if (unlockAt && isVaultLockActive(unlockAt)) return unlockAt;
      if (unlockAt && path === RORUSH_PATHS.vault.info) return unlockAt;
    } catch {
      /* try alternate path */
    }
  }
  return null;
}

export function vaultLockExpiresAtIso(minutes: number, fromMs = Date.now()): string {
  return new Date(fromMs + minutes * 60_000).toISOString();
}

export function isVaultLockActive(expiresAtIso: string | null | undefined): boolean {
  if (!expiresAtIso?.trim()) return false;
  const t = Date.parse(expiresAtIso);
  return !Number.isNaN(t) && t > Date.now();
}

export async function fetchVaultBalanceCoins(
  client: RoRushHttpClient,
  currency: VaultCurrency = "CRYPTO",
): Promise<number | null> {
  const paths = [
    RORUSH_PATHS.vault.info,
    `${RORUSH_PATHS.vault.info}?currency=${currency.toLowerCase()}`,
  ];
  for (const path of paths) {
    try {
      const info = await client.request<unknown>(path);
      const cents = parseBalanceCents(info);
      if (cents != null) return cents / 100;
    } catch {
      /* try next */
    }
  }
  return null;
}

/** Debug: raw lock response + vault info (for VPS troubleshooting). */
export async function debugVaultLockProbe(
  client: RoRushHttpClient,
  minutes: number,
): Promise<{ lockResponse: unknown; infoPaths: Array<{ path: string; body: unknown }> }> {
  const duration = vaultLockApiDurationFromMinutes(minutes);
  if (!duration) throw new Error("Invalid lock duration");
  const lockResponse = await client.request<unknown>(RORUSH_PATHS.vault.lock, {
    method: "POST",
    body: JSON.stringify({ duration }),
  });
  const infoPaths: Array<{ path: string; body: unknown }> = [];
  for (const path of [
    RORUSH_PATHS.vault.info,
    `${RORUSH_PATHS.vault.info}?currency=crypto`,
  ]) {
    try {
      infoPaths.push({ path, body: await client.request<unknown>(path) });
    } catch (err) {
      infoPaths.push({
        path,
        body: err instanceof Error ? err.message : String(err),
      });
    }
  }
  return { lockResponse, infoPaths };
}
