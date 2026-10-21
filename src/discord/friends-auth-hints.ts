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

export function appendSessionHintIfNeeded(text: string, account?: AccountRow | null): string {
  const fromText = isSessionJwtError(text);
  const fromAccount =
    account?.session_jwt_enc &&
    !account.password_enc &&
    isSessionJwtError(account.last_error);
  if (!fromText && !fromAccount) return text;
  if (text.includes("/account session")) return text;
  return `${text}\n\n${sessionJwtDiscordHint()}`;
}
