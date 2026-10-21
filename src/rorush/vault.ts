import { parseBalanceCents } from "./balance-level.js";
import type { RoRushHttpClient } from "./http-client.js";
import { RORUSH_PATHS } from "./endpoints.js";

export type VaultCurrency = "CRYPTO" | "ROBUX";

/** RoRush vault deposit (wallet → vault). Amount is in coins; API uses cents like limbo. */
export async function depositCoinsToVault(
  client: RoRushHttpClient,
  amountCoins: number,
  currency: VaultCurrency = "CRYPTO",
  lockMinutes?: number,
): Promise<void> {
  if (!Number.isFinite(amountCoins) || amountCoins < 0.01) {
    throw new Error("Vault deposit must be at least 0.01 coins");
  }
  const amountCents = Math.max(1, Math.round(amountCoins * 100));
  const body: Record<string, unknown> = { amount: amountCents, currency };
  if (lockMinutes != null && lockMinutes > 0) {
    body.lockMinutes = lockMinutes;
    body.durationMinutes = lockMinutes;
  }
  try {
    await client.request(RORUSH_PATHS.vault.deposit, {
      method: "POST",
      body: JSON.stringify(body),
    });
  } catch (err) {
    if (!lockMinutes) throw err;
    await client.request(RORUSH_PATHS.vault.deposit, {
      method: "POST",
      body: JSON.stringify({ amount: amountCents, currency }),
    });
    await lockVaultForMinutes(client, lockMinutes);
  }
}

/** Timed vault lock — withdraw blocked on RoRush until duration elapses; deposits still allowed. */
export async function lockVaultForMinutes(client: RoRushHttpClient, minutes: number): Promise<void> {
  if (!Number.isFinite(minutes) || minutes < 1) {
    throw new Error("Vault lock duration must be at least 1 minute");
  }
  const rounded = Math.round(minutes);
  const bodies = [
    { minutes: rounded },
    { durationMinutes: rounded },
    { duration: rounded },
  ];
  let lastErr: unknown;
  for (const body of bodies) {
    try {
      await client.request(RORUSH_PATHS.vault.lock, {
        method: "POST",
        body: JSON.stringify(body),
      });
      return;
    } catch (err) {
      lastErr = err;
    }
  }
  throw lastErr instanceof Error ? lastErr : new Error(String(lastErr));
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
