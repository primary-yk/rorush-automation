import type { RoRushHttpClient } from "./http-client.js";
import { RORUSH_PATHS } from "./endpoints.js";
import { vaultLockApiDurationFromMinutes } from "./vault-lock.js";
import { extractRoRushErrorMessage, parseVaultUnlockAt } from "./vault-unlock.js";
import { fetchVaultSnapshot, snapshotLocked, type VaultSnapshot } from "./vault-state.js";

export type VaultCurrency = "CRYPTO" | "ROBUX";

const SITE_ORIGIN = "https://rorush.com";

function browserLikeHeaders(): Record<string, string> {
  return {
    Origin: SITE_ORIGIN,
    Referer: `${SITE_ORIGIN}/`,
  };
}

function isEmptyObject(data: unknown): boolean {
  return (
    data != null &&
    typeof data === "object" &&
    !Array.isArray(data) &&
    Object.keys(data as object).length === 0
  );
}

async function prepareVaultSession(client: RoRushHttpClient): Promise<VaultSnapshot> {
  await client.setBalanceToken("coin").catch(() => undefined);
  return fetchVaultSnapshot(client);
}

type LockAttempt = { path: string; body: Record<string, string> };

function lockAttempts(duration: string, apiKey: string | null | undefined): LockAttempt[] {
  const base = RORUSH_PATHS.vault.lock;
  const qCrypto = `${base}?currency=crypto`;
  const withKey =
    apiKey?.trim() ?
      [`${base}?api_key=${encodeURIComponent(apiKey.trim())}`, `${qCrypto}&api_key=${encodeURIComponent(apiKey.trim())}`]
    : [];
  const paths = [base, qCrypto, ...withKey];
  const bodies: Record<string, string>[] = [{ duration }, { duration, currency: "CRYPTO" }];
  const out: LockAttempt[] = [];
  for (const path of paths) {
    for (const body of bodies) {
      out.push({ path, body });
    }
  }
  return out;
}

async function postVaultLock(
  client: RoRushHttpClient,
  attempt: LockAttempt,
): Promise<unknown> {
  return client.request<unknown>(attempt.path, {
    method: "POST",
    headers: browserLikeHeaders(),
    body: JSON.stringify(attempt.body),
  });
}

async function pollVaultLock(
  client: RoRushHttpClient,
  maxMs = 4_000,
): Promise<VaultSnapshot | null> {
  const deadline = Date.now() + maxMs;
  while (Date.now() < deadline) {
    const snap = await fetchVaultSnapshot(client);
    if (snapshotLocked(snap)) return snap;
    await new Promise((r) => setTimeout(r, 350));
  }
  return null;
}

export type VaultLockResult = {
  unlockAt: string;
  confirmedOnRoRush: boolean;
};

/** Timed vault lock — withdraw blocked on RoRush until duration elapses; deposits still allowed. */
export async function lockVaultForMinutes(
  client: RoRushHttpClient,
  minutes: number,
  creds?: { apiKey?: string | null },
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

  await prepareVaultSession(client);

  let lastData: unknown = null;
  let unlockAt: string | null = null;

  for (const attempt of lockAttempts(duration, creds?.apiKey)) {
    lastData = await postVaultLock(client, attempt);
    const apiMsg = extractRoRushErrorMessage(lastData);
    if (apiMsg && !parseVaultUnlockAt(lastData)) {
      throw new Error(`RoRush vault lock: ${apiMsg}`);
    }
    unlockAt = parseVaultUnlockAt(lastData);
    if (unlockAt && snapshotLocked({ balanceCoins: null, unlockAtIso: unlockAt })) {
      return { unlockAt, confirmedOnRoRush: true };
    }
    const polled = await pollVaultLock(client, 2_500);
    if (polled?.unlockAtIso && snapshotLocked(polled)) {
      return { unlockAt: polled.unlockAtIso, confirmedOnRoRush: true };
    }
    if (!isEmptyObject(lastData) && unlockAt) {
      return { unlockAt, confirmedOnRoRush: snapshotLocked({ balanceCoins: null, unlockAtIso: unlockAt }) };
    }
  }

  const finalPoll = await pollVaultLock(client, 2_000);
  if (finalPoll?.unlockAtIso && snapshotLocked(finalPoll)) {
    return { unlockAt: finalPoll.unlockAtIso, confirmedOnRoRush: true };
  }

  if (unlockAt) {
    return {
      unlockAt,
      confirmedOnRoRush: snapshotLocked({ balanceCoins: null, unlockAtIso: unlockAt }),
    };
  }

  return {
    unlockAt: vaultLockExpiresAtIso(minutes),
    confirmedOnRoRush: false,
  };
}

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
    headers: browserLikeHeaders(),
    body: JSON.stringify({ amount: amountCents, currency }),
  });
}

export async function fetchVaultUnlockAt(
  client: RoRushHttpClient,
  _currency: VaultCurrency = "CRYPTO",
): Promise<string | null> {
  const snap = await fetchVaultSnapshot(client);
  return snap.unlockAtIso;
}

export function vaultLockExpiresAtIso(minutes: number, fromMs = Date.now()): string {
  return new Date(fromMs + minutes * 60_000).toISOString();
}

export function isVaultLockActive(expiresAtIso: string | null | undefined): boolean {
  return snapshotLocked({ balanceCoins: null, unlockAtIso: expiresAtIso ?? null });
}

export async function fetchVaultBalanceCoins(client: RoRushHttpClient): Promise<number | null> {
  const snap = await fetchVaultSnapshot(client);
  return snap.balanceCoins;
}

export async function debugVaultLockProbe(
  client: RoRushHttpClient,
  minutes: number,
  creds?: { apiKey?: string | null },
): Promise<{ lockResponse: unknown; infoPaths: Array<{ path: string; body: unknown }> }> {
  const duration = vaultLockApiDurationFromMinutes(minutes);
  if (!duration) throw new Error("Invalid lock duration");
  await prepareVaultSession(client);
  const lockResponse = await postVaultLock(client, { path: RORUSH_PATHS.vault.lock, body: { duration } });
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
  void creds;
  return { lockResponse, infoPaths };
}
