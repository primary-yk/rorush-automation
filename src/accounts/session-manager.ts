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
  updateAccount(account.id, {
    session_jwt_enc: encryptField(jwt),
    api_key_enc: encryptField(apiKey),
    last_error: null,
    status: "idle",
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
    try {
      await client.authStatus();
    } catch {
      updateAccount(accountId, { session_jwt_enc: null });
      account = getAccount(accountId)!;
      creds = await resolveCredentials(account);
      if (!creds) throw new Error("Session expired and re-login failed");
      client = new RoRushHttpClient(creds, account.proxy_url);
      await client.authStatus();
    }

    return { account, client, creds };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    updateAccount(accountId, { status: "error", last_error: message });
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
