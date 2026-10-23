import { randomUUID } from "node:crypto";
import { isTransientNetworkError } from "../captcha/solve.js";
import { requireEncryptionKey } from "../config.js";
import { decryptSecret, encryptSecret } from "../crypto/secret-box.js";
import {
  getAccount,
  updateAccount,
  type AccountRow,
} from "../db/repositories.js";
import { parseJwtExpiryUtc } from "./jwt-expiry.js";
import { parseApiKey, parseCurrentBalanceToken } from "../rorush/balance-token.js";
import { RoRushHttpClient, type RoRushCredentials } from "../rorush/http-client.js";

export type AccountSecrets = {
  jwt: string;
  apiKey?: string | null;
};

export function encryptField(value: string | null | undefined): string | null {
  if (!value) return null;
  return encryptSecret(value, requireEncryptionKey());
}

export function decryptField(value: string | null | undefined): string | null {
  if (!value) return null;
  return decryptSecret(value, requireEncryptionKey());
}

/** RoRush web client uses localStorage apiKey; generate one if login did not provide it. */
export function ensureAccountApiKey(accountId: number): string {
  const account = getAccount(accountId);
  if (!account) throw new Error("Account not found");
  const existing = decryptField(account.api_key_enc)?.trim();
  if (existing) return existing;
  const generated = randomUUID();
  updateAccount(accountId, { api_key_enc: encryptField(generated) });
  return generated;
}

/** Check email/password against RoRush before saving (Discord `/account add`, dashboard). */
export async function verifyRoRushEmailPassword(
  email: string,
  password: string,
): Promise<
  | { ok: true; jwt: string; apiKey: string | null; level: number | null }
  | { ok: false; message: string }
> {
  const username = email.trim();
  if (!username || !password) {
    return { ok: false, message: "Email and password are required." };
  }
  const client = new RoRushHttpClient({ jwt: "" }, null);
  try {
    const login = await client.loginEmail(username, password);
    if (login.twoFactorToken) {
      return {
        ok: false,
        message:
          "RoRush wants 2FA for this account — use **`/account session`** with a JWT from your browser instead of password.",
      };
    }
    const jwt = login.userInfo?.jwtToken;
    if (!jwt) {
      return { ok: false, message: login.message ?? "Login failed — check email and password." };
    }
    client.setCredentials({ jwt, apiKey: login.userInfo?.apiKey ?? parseApiKey(login) ?? undefined });
    let apiKey =
      (login.userInfo?.apiKey ??
        parseApiKey(login) ??
        (await readApiKeyFromRoRush(client))) ||
      null;
    if (!apiKey) {
      apiKey = randomUUID();
    }
    const level = login.userInfo?.level;
    return {
      ok: true,
      jwt,
      apiKey,
      level: typeof level === "number" && Number.isFinite(level) ? Math.trunc(level) : null,
    };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    if (/credentials|invalid|401|403|unauthorized/i.test(msg)) {
      return {
        ok: false,
        message: "RoRush rejected that email or password — fix the typo or use **`/account session`** if you sign in with Discord/Google.",
      };
    }
    return { ok: false, message: `Could not reach RoRush to verify login — try again in a minute. (${msg})` };
  }
}

async function readApiKeyFromRoRush(client: RoRushHttpClient): Promise<string> {
  for (const fetch of [
    () => client.authStatus(),
    () => client.getStats(),
    () => client.getLevel(),
  ]) {
    try {
      const key = parseApiKey(await fetch());
      if (key?.trim()) return key.trim();
    } catch {
      /* try next */
    }
  }
  return "";
}

async function syncApiKeyFromRoRush(
  accountId: number,
  client: RoRushHttpClient,
  creds: RoRushCredentials,
  hints: { fromLogin?: string | null; preferFresh?: boolean } = {},
): Promise<RoRushCredentials> {
  const stored = decryptField(getAccount(accountId)?.api_key_enc)?.trim() || "";
  let apiKey = "";
  if (hints.preferFresh) {
    apiKey = hints.fromLogin?.trim() || (await readApiKeyFromRoRush(client)) || "";
    if (!apiKey) {
      apiKey = rotateAccountApiKey(accountId);
    } else {
      updateAccount(accountId, { api_key_enc: encryptField(apiKey) });
    }
    const next = { ...creds, apiKey };
    client.setCredentials(next);
    return next;
  } else {
    apiKey =
      hints.fromLogin?.trim() ||
      creds.apiKey?.trim() ||
      stored ||
      "";
    if (!apiKey) {
      apiKey = await readApiKeyFromRoRush(client);
    }
  }
  if (!apiKey) {
    apiKey = ensureAccountApiKey(accountId);
  } else {
    updateAccount(accountId, { api_key_enc: encryptField(apiKey) });
  }
  const next = { ...creds, apiKey };
  client.setCredentials(next);
  return next;
}

/** New x-api-key for vault lock retry (email/password accounts — mimics a fresh browser tab). */
export function rotateAccountApiKey(accountId: number): string {
  const generated = randomUUID();
  updateAccount(accountId, { api_key_enc: encryptField(generated) });
  return generated;
}

type OpenClientOptions = { vaultBootstrap?: boolean };

async function openAuthenticatedClient(
  account: AccountRow,
  opts: OpenClientOptions = {},
): Promise<{ creds: RoRushCredentials; client: RoRushHttpClient } | null> {
  const jwtFromSession = decryptField(account.session_jwt_enc);
  const storedApiKey = decryptField(account.api_key_enc)?.trim() || null;
  if (jwtFromSession) {
    const client = new RoRushHttpClient(
      { jwt: jwtFromSession, apiKey: storedApiKey },
      account.proxy_url,
    );
    const creds = await syncApiKeyFromRoRush(account.id, client, {
      jwt: jwtFromSession,
      apiKey: storedApiKey,
    });
    return { creds, client };
  }

  const username = account.username;
  const password = decryptField(account.password_enc);
  if (!username || !password) return null;

  // Match verifyRoRushEmailPassword: do not invent x-api-key before login (site uses "" until bound).
  const client = new RoRushHttpClient(
    { jwt: "", apiKey: opts.vaultBootstrap ? undefined : (storedApiKey ?? undefined) },
    account.proxy_url,
  );
  const login = await client.loginEmail(username, password);
  if (login.twoFactorToken) {
    throw new Error("Account requires 2FA; paste a session JWT instead.");
  }
  const jwt = login.userInfo?.jwtToken;
  if (!jwt) {
    throw new Error(login.message ?? "Login failed");
  }
  const loginHint = login.userInfo?.apiKey ?? parseApiKey(login) ?? null;
  const level = login.userInfo?.level;
  const walletToken = parseCurrentBalanceToken(login.userInfo ?? login);
  client.setCredentials({ jwt, apiKey: loginHint ?? storedApiKey ?? undefined });
  const creds = await syncApiKeyFromRoRush(account.id, client, { jwt, apiKey: loginHint ?? storedApiKey }, {
    fromLogin: loginHint,
    preferFresh: opts.vaultBootstrap,
  });
  updateAccount(account.id, {
    session_jwt_enc: encryptField(jwt),
    api_key_enc: encryptField(creds.apiKey ?? null),
    last_error: null,
    status: "idle",
    ...(typeof level === "number" && Number.isFinite(level) ? { level: Math.trunc(level) } : {}),
    ...(walletToken ? { wallet_balance_token: walletToken } : {}),
  });
  return { creds, client };
}

export async function resolveCredentials(account: AccountRow): Promise<RoRushCredentials | null> {
  const opened = await openAuthenticatedClient(account);
  return opened?.creds ?? null;
}

/** Vault lock often needs a fresh login (session cookies + JWT). Deposit/rain can reuse cached JWT. */
export async function ensureAuthenticatedForVault(accountId: number): Promise<{
  account: AccountRow;
  client: RoRushHttpClient;
  creds: RoRushCredentials;
}> {
  updateAccount(accountId, { session_jwt_enc: null });
  return ensureAuthenticated(accountId, { vaultBootstrap: true });
}

export async function ensureAuthenticated(
  accountId: number,
  opts: OpenClientOptions = {},
): Promise<{
  account: AccountRow;
  client: RoRushHttpClient;
  creds: RoRushCredentials;
}> {
  let account = getAccount(accountId);
  if (!account) throw new Error("Account not found");

  if (account.password_enc?.trim() && account.session_jwt_enc?.trim()) {
    const cachedJwt = decryptField(account.session_jwt_enc);
    if (cachedJwt) {
      const exp = parseJwtExpiryUtc(cachedJwt);
      if (exp && exp.getTime() <= Date.now() + 5 * 60_000) {
        updateAccount(accountId, { session_jwt_enc: null });
        account = getAccount(accountId)!;
      }
    }
  }

  try {
    let opened = await openAuthenticatedClient(account, opts);
    if (!opened) throw new Error("No credentials configured");

    let { creds, client } = opened;
    ({ creds, client } = await refreshApiKeyFromRoRush(accountId, client, creds));
    const sessionInvalid = await validateSession(client);
    if (sessionInvalid) {
      updateAccount(accountId, { session_jwt_enc: null });
      account = getAccount(accountId)!;
      opened = await openAuthenticatedClient(account, opts);
      if (!opened) throw new Error("Session expired and re-login failed");
      ({ creds, client } = opened);
      ({ creds, client } = await refreshApiKeyFromRoRush(accountId, client, creds));
      const stillBad = await validateSession(client);
      if (stillBad) throw new Error("Session expired and re-login failed");
    }

    return { account: getAccount(accountId)!, client, creds };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    if (!isTransientNetworkError(err)) {
      updateAccount(accountId, { status: "error", last_error: message });
    }
    throw err;
  }
}

export function looksLikeAuthError(message: string): boolean {
  const m = message.toLowerCase();
  return (
    m.includes("401") ||
    m.includes("403") ||
    m.includes("unauthorized") ||
    m.includes("not authenticated") ||
    m.includes("invalid token") ||
    m.includes("session expired")
  );
}

/** Returns true when stored JWT should be discarded and login retried. */
async function refreshApiKeyFromRoRush(
  accountId: number,
  client: RoRushHttpClient,
  creds: RoRushCredentials,
): Promise<{ creds: RoRushCredentials; client: RoRushHttpClient }> {
  try {
    const status = await client.authStatus();
    const fromAuth = parseApiKey(status);
    if (!fromAuth || fromAuth === creds.apiKey) {
      return { creds, client };
    }
    updateAccount(accountId, { api_key_enc: encryptField(fromAuth) });
    const next = { ...creds, apiKey: fromAuth };
    client.setCredentials(next);
    return { creds: next, client };
  } catch {
    return { creds, client };
  }
}

async function validateSession(client: RoRushHttpClient): Promise<boolean> {
  try {
    const status = await client.authStatus();
    if (status.authenticated === false) return true;
    return false;
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    if (looksLikeAuthError(message)) return true;
    throw err;
  }
}

/** Re-login once when RoRush returns invalid/expired session mid-flow (mines, wallet switch, etc.). */
export async function withRoRushAuthRecovery<T>(
  accountId: number,
  run: (client: RoRushHttpClient) => Promise<T>,
  opts?: { disconnectHub?: () => Promise<void> },
): Promise<T> {
  const retryOnce = async (): Promise<T> => {
    if (opts?.disconnectHub) await opts.disconnectHub().catch(() => undefined);
    const row = getAccount(accountId);
    const opened = row?.password_enc?.trim()
      ? await ensureAuthenticatedForVault(accountId)
      : await (async () => {
          updateAccount(accountId, { session_jwt_enc: null });
          return ensureAuthenticated(accountId);
        })();
    return run(opened.client);
  };

  try {
    const opened = await ensureAuthenticated(accountId);
    try {
      return await run(opened.client);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      if (!looksLikeAuthError(msg)) throw err;
      return retryOnce();
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    if (!looksLikeAuthError(msg)) throw err;
    return retryOnce();
  }
}

export async function setSessionToken(
  accountId: number,
  jwt: string,
  apiKey?: string | null,
): Promise<void> {
  updateAccount(accountId, {
    session_jwt_enc: encryptField(jwt),
    api_key_enc: encryptField(apiKey ?? null),
    last_error: null,
  });
}
