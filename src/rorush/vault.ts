import { parseBalanceCents } from "./balance-level.js";
import { readCurrentBalanceToken } from "./balance-token.js";
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

async function prepareVaultLockContext(client: RoRushHttpClient): Promise<void> {
  const token = await readCurrentBalanceToken(client);
  if (token !== "coin") {
    await client.setBalanceToken("coin").catch(() => undefined);
  }
}

function isEmptyLockResponse(data: unknown): boolean {
  return (
    data == null ||
    (typeof data === "object" && !Array.isArray(data) && Object.keys(data as object).length === 0)
  );
}

async function postVaultLock(
  client: RoRushHttpClient,
  body: Record<string, string>,
): Promise<unknown> {
  return client.request<unknown>(RORUSH_PATHS.vault.lock, {
    method: "POST",
    body: JSON.stringify(body),
  });
}

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
  await prepareVaultLockContext(client);
  const beforeUnlock = await fetchVaultUnlockAt(client);

  const bodies: Record<string, string>[] = [{ duration }, { duration, currency: "CRYPTO" }];
  let data: unknown = null;
  for (const body of bodies) {
    data = await postVaultLock(client, body);
    if (!isEmptyLockResponse(data) && parseVaultUnlockAt(data)) break;
    if (!isEmptyLockResponse(data) && extractRoRushErrorMessage(data)) break;
  }

  const apiMsg = extractRoRushErrorMessage(data);
  if (apiMsg && !parseVaultUnlockAt(data)) {
    throw new Error(`RoRush vault lock: ${apiMsg}`);
  }

  let unlockAt = parseVaultUnlockAt(data);
  for (let i = 0; i < 6 && (!unlockAt || !isVaultLockActive(unlockAt)); i++) {
    await new Promise((r) => setTimeout(r, 400));
    unlockAt = await fetchVaultUnlockAt(client);
    if (unlockAt && isVaultLockActive(unlockAt)) break;
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
    if (isEmptyLockResponse(data)) {
      throw new Error(
        "RoRush vault lock returned an empty response (no timer). " +
          "On rorush.com open DevTools → Application → Local Storage → copy **apiKey**, then run " +
          "`/account session` with **api_key** set to that value (email/password login often omits it). " +
          "Zero vault balance is OK — lock should still work once apiKey matches the site.",
      );
    }
    throw new Error(
      "RoRush did not confirm a vault lock (no unlock timer on /vault/info). " +
        "Try `/account session` with JWT + api_key from the browser, then test again.",
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
