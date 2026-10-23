import { parseJwtExpiryUtc } from "../accounts/jwt-expiry.js";
import { decryptField } from "../accounts/session-manager.js";
import type { AccountRow } from "../db/repositories.js";
import { isSessionJwtError } from "./friends-auth-hints.js";

export type SessionHealthLevel = "healthy" | "attention" | "action";

export type SessionHealthSummary = {
  nickname: string;
  level: SessionHealthLevel;
  label: string;
  detail: string;
};

const MS_DAY = 86_400_000;
const MS_HOUR = 3_600_000;

export { parseJwtExpiryUtc } from "../accounts/jwt-expiry.js";

function formatExpiryRelative(exp: Date, now = Date.now()): string {
  const delta = exp.getTime() - now;
  if (delta <= 0) return "expired";
  if (delta < MS_HOUR) {
    const mins = Math.max(1, Math.round(delta / 60_000));
    return `expires in ~${mins} min`;
  }
  if (delta < MS_DAY) {
    const hrs = Math.round(delta / MS_HOUR);
    return `expires in ~${hrs}h`;
  }
  const days = Math.round(delta / MS_DAY);
  return `expires in ~${days}d`;
}

function formatExpiryClock(exp: Date): string {
  return exp.toISOString().replace("T", " ").slice(0, 16) + " UTC";
}

function truncateError(msg: string, max = 120): string {
  const t = msg.trim().replace(/\s+/g, " ");
  if (t.length <= max) return t;
  return `${t.slice(0, max - 1)}…`;
}

export function assessAccountSessionHealth(account: AccountRow): SessionHealthSummary {
  const nickname = account.nickname;
  const hasPassword = Boolean(account.password_enc?.trim());
  const hasSession = Boolean(account.session_jwt_enc?.trim());
  const authError = isSessionJwtError(account.last_error);

  if (!hasPassword && !hasSession) {
    return {
      nickname,
      level: "action",
      label: "No credentials",
      detail: "Re-link with **`/account add`** or **`/account session`**.",
    };
  }

  if (authError) {
    return {
      nickname,
      level: "action",
      label: "Login required",
      detail: hasPassword
        ? "RoRush rejected the saved login — update password or use **`/account session`**."
        : "Session JWT expired — run **`/account session`** with a fresh token.",
    };
  }

  if (account.status === "error" && account.last_error?.trim()) {
    return {
      nickname,
      level: "attention",
      label: "Needs attention",
      detail: truncateError(account.last_error),
    };
  }

  const jwt = hasSession ? decryptField(account.session_jwt_enc) : null;
  const jwtExp = jwt ? parseJwtExpiryUtc(jwt) : null;

  if (!hasPassword && jwtExp) {
    const now = Date.now();
    if (jwtExp.getTime() <= now) {
      return {
        nickname,
        level: "action",
        label: "JWT expired",
        detail: "Token date passed — paste a new JWT with **`/account session`**.",
      };
    }
    const delta = jwtExp.getTime() - now;
    if (delta < MS_DAY) {
      return {
        nickname,
        level: "attention",
        label: "JWT ending soon",
        detail: `${formatExpiryRelative(jwtExp)} (${formatExpiryClock(jwtExp)}) · refresh with /account session.`,
      };
    }
    if (delta < 3 * MS_DAY) {
      return {
        nickname,
        level: "attention",
        label: "JWT active",
        detail: `${formatExpiryRelative(jwtExp)} · ${formatExpiryClock(jwtExp)}`,
      };
    }
  }

  if (hasPassword) {
    return {
      nickname,
      level: "healthy",
      label: "Password login",
      detail: "The bot can refresh the session automatically when RoRush allows it.",
    };
  }

  return {
    nickname,
    level: "healthy",
    label: "Session JWT",
    detail: jwtExp
      ? `Valid · ${formatExpiryClock(jwtExp)}`
      : "No expiry in token — last balance refresh succeeded.",
  };
}

const LEVEL_TAG: Record<SessionHealthLevel, string> = {
  healthy: "OK",
  attention: "Check",
  action: "Fix",
};

/** Discord field value (≤1024). */
export function formatSessionHealthPanel(accounts: AccountRow[]): string {
  if (accounts.length === 0) {
    return "Link an account to see login health here.";
  }
  const lines = accounts.map((a) => {
    const s = assessAccountSessionHealth(a);
    return `\`${LEVEL_TAG[s.level]}\` **${s.nickname}** — ${s.label}\n${s.detail}`;
  });
  lines.push("");
  lines.push(
    "_**OK** = good to run · **Check** = refresh JWT soon · **Fix** = update login. Opening the dashboard re-validates with RoRush._",
  );
  return lines.join("\n\n").slice(0, 1024);
}

export function worstSessionHealthLevel(accounts: AccountRow[]): SessionHealthLevel | null {
  if (accounts.length === 0) return null;
  const order: SessionHealthLevel[] = ["action", "attention", "healthy"];
  let worst: SessionHealthLevel = "healthy";
  for (const a of accounts) {
    const level = assessAccountSessionHealth(a).level;
    if (order.indexOf(level) < order.indexOf(worst)) worst = level;
  }
  return worst;
}
