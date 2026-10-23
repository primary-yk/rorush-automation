import { isTransientNetworkError } from "../captcha/solve.js";
import { requireEncryptionKey } from "../config.js";
import { decryptSecret, encryptSecret } from "../crypto/secret-box.js";
import {
  getAccount,
  updateAccount,
  type AccountRow,
} from "../db/repositories.js";
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
    const level = login.userInfo?.level;
    return {
      ok: true,
      jwt,
      apiKey: login.userInfo?.apiKey ?? null,
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
  const walletToken = parseCurrentBalanceToken(login.userInfo ?? login);
  updateAccount(account.id, {
    session_jwt_enc: encryptField(jwt),
    api_key_enc: encryptField(apiKey),
    last_error: null,
    status: "idle",
    ...(typeof level === "number" && Number.isFinite(level) ? { level: Math.trunc(level) } : {}),
    ...(walletToken ? { wallet_balance_token: walletToken } : {}),
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
    ({ creds, client } = await refreshApiKeyFromRoRush(accountId, client, creds));
    const sessionInvalid = await validateSession(client);
    if (sessionInvalid) {
      updateAccount(accountId, { session_jwt_enc: null, api_key_enc: null });
      account = getAccount(accountId)!;
      creds = await resolveCredentials(account);
      if (!creds) throw new Error("Session expired and re-login failed");
      client = new RoRushHttpClient(creds, account.proxy_url);
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
    return { creds: next, client: new RoRushHttpClient(next, getAccount(accountId)?.proxy_url) };
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
