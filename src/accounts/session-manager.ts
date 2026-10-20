import { isTransientNetworkError } from "../captcha/solve.js";
import { requireEncryptionKey } from "../config.js";
import { decryptSecret, encryptSecret } from "../crypto/secret-box.js";
import {
  getAccount,
  updateAccount,
  type AccountRow,
} from "../db/repositories.js";
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

export async function resolveCredentials(account: AccountRow): Promise<RoRushCredentials | null> {
  const jwtFromSession = decryptField(account.session_jwt_enc);
  if (jwtFromSession) {
    return {
      jwt: jwtFromSession,
      apiKey: decryptField(account.api_key_enc),
    };
  }

  const username = account.username;
  const password = decryptField(account.password_enc);
  if (!username || !password) return null;

  const tempClient = new RoRushHttpClient({ jwt: "" }, account.proxy_url);
  const login = await tempClient.loginEmail(username, password);
  if (login.twoFactorToken) {
    throw new Error("Account requires 2FA; paste a session JWT instead.");
  }
  const jwt = login.userInfo?.jwtToken;
  if (!jwt) {
    throw new Error(login.message ?? "Login failed");
  }
  const apiKey = login.userInfo?.apiKey ?? null;
  const level = login.userInfo?.level;
  updateAccount(account.id, {
    session_jwt_enc: encryptField(jwt),
    api_key_enc: encryptField(apiKey),
    last_error: null,
    status: "idle",
    ...(typeof level === "number" && Number.isFinite(level) ? { level: Math.trunc(level) } : {}),
  });
  return { jwt, apiKey };
}

export async function ensureAuthenticated(accountId: number): Promise<{
  account: AccountRow;
  client: RoRushHttpClient;
  creds: RoRushCredentials;
}> {
  let account = getAccount(accountId);
  if (!account) throw new Error("Account not found");

  try {
    let creds = await resolveCredentials(account);
    if (!creds) throw new Error("No credentials configured");

    let client = new RoRushHttpClient(creds, account.proxy_url);
    const sessionInvalid = await validateSession(client);
    if (sessionInvalid) {
      updateAccount(accountId, { session_jwt_enc: null, api_key_enc: null });
      account = getAccount(accountId)!;
      creds = await resolveCredentials(account);
      if (!creds) throw new Error("Session expired and re-login failed");
      client = new RoRushHttpClient(creds, account.proxy_url);
      const stillBad = await validateSession(client);
      if (stillBad) throw new Error("Session expired and re-login failed");
    }

    return { account, client, creds };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    if (!isTransientNetworkError(err)) {
      updateAccount(accountId, { status: "error", last_error: message });
    }
    throw err;
  }
}

function looksLikeAuthError(message: string): boolean {
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
