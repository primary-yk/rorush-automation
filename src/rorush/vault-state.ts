import { parseBalanceCents } from "./balance-level.js";
import type { RoRushHttpClient } from "./http-client.js";
import { RORUSH_PATHS } from "./endpoints.js";
import { isBareBalanceCentsBody, parseVaultUnlockAt } from "./vault-unlock.js";

export type VaultSnapshot = {
  balanceCoins: number | null;
  unlockAtIso: string | null;
};

export function snapshotLocked(snapshot: VaultSnapshot, now = Date.now()): boolean {
  if (!snapshot.unlockAtIso?.trim()) return false;
  const t = Date.parse(snapshot.unlockAtIso);
  return !Number.isNaN(t) && t > now;
}

const SITE_ORIGIN = "https://rorush.com";

function vaultInfoHeaders(): Record<string, string> {
  return { Origin: SITE_ORIGIN, Referer: `${SITE_ORIGIN}/` };
}

export async function fetchVaultSnapshot(
  client: RoRushHttpClient,
  currency: "CRYPTO" | "ROBUX" = "CRYPTO",
): Promise<VaultSnapshot> {
  const paths = [
    RORUSH_PATHS.vault.info,
    `${RORUSH_PATHS.vault.info}?currency=${currency.toLowerCase()}`,
    `${RORUSH_PATHS.vault.info}?currency=${currency}`,
  ];
  let balanceCoins: number | null = null;
  let unlockAtIso: string | null = null;

  for (const path of paths) {
    try {
      const body = await client.request<unknown>(path, { headers: vaultInfoHeaders() });
      if (isBareBalanceCentsBody(body)) {
        balanceCoins = body / 100;
        continue;
      }
      const cents = parseBalanceCents(body);
      if (cents != null) balanceCoins = cents / 100;
      unlockAtIso = parseVaultUnlockAt(body) ?? unlockAtIso;
    } catch {
      /* try next */
    }
  }

  return { balanceCoins, unlockAtIso };
}
