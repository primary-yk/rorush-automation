import { parseBalanceCents } from "./balance-level.js";
import type { RoRushHttpClient } from "./http-client.js";
import { RORUSH_PATHS } from "./endpoints.js";
import { vaultLockApiDurationFromMinutes } from "./vault-lock.js";
import { parseVaultUnlockAt } from "./vault-unlock.js";

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
  const data = await client.request<unknown>(RORUSH_PATHS.vault.lock, {
    method: "POST",
    body: JSON.stringify({ duration }),
  });
  let unlockAt = parseVaultUnlockAt(data);
  if (!unlockAt) {
    unlockAt = await fetchVaultUnlockAt(client);
  }
  if (!unlockAt || !isVaultLockActive(unlockAt)) {
    throw new Error(
      "RoRush did not confirm a vault lock (no unlock timer on the site). " +
        "Log in on rorush.com, try locking vault once in the UI, then run `/rorush vault` again.",
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
      const unlockAt = parseVaultUnlockAt(info);
      if (unlockAt) return unlockAt;
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
  const info = await client.request<unknown>(`${RORUSH_PATHS.vault.info}?currency=${currency.toLowerCase()}`);
  const cents = parseBalanceCents(info);
  return cents != null ? cents / 100 : null;
}
