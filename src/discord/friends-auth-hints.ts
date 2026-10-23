import type { AccountRow } from "../db/repositories.js";

export function isSessionJwtError(message: string | null | undefined): boolean {
  if (!message?.trim()) return false;
  const m = message.toLowerCase();
  return (
    m.includes("session expired") ||
    m.includes("invalid token") ||
    m.includes("not authenticated") ||
    m.includes("unauthorized") ||
    m.includes("re-login failed") ||
    m.includes("paste a session jwt") ||
    m.includes("401") ||
    m.includes("403")
  );
}

export function sessionJwtDiscordHint(): string {
  return "Session expired — run **`/account session`** with a fresh JWT from the site (same value as **Session JWT** in account settings).";
}

/** What to do after RoRush auth errors — respects email/password vs JWT-only accounts. */
export function authRecoveryDiscordHint(account?: AccountRow | null): string {
  if (account?.password_enc?.trim()) {
    return (
      "Run **`/account refresh`** to log in again with your saved **email & password** " +
      "(no JWT paste needed). If you changed your password on the site, run **`/account add`** again with the same nickname."
    );
  }
  if (account?.session_jwt_enc?.trim()) {
    return sessionJwtDiscordHint();
  }
  return "Re-link with **`/account add`** (email & password) or **`/account session`** (browser JWT).";
}

export function appendSessionHintIfNeeded(text: string, account?: AccountRow | null): string {
  const fromText = isSessionJwtError(text);
  const fromAccount = account && isSessionJwtError(account.last_error);
  if (!fromText && !fromAccount) return text;
  const hint = authRecoveryDiscordHint(account);
  if (text.includes("/account refresh") || text.includes("/account add")) return text;
  if (!account?.password_enc?.trim() && text.includes("/account session")) return text;
  return `${text}\n\n${hint}`;
}
