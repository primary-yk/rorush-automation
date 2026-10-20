export type ActivityLogRow = {
  account_id: number | null;
  category: string;
  message: string;
  detail: string | null;
  created_at: string;
};

/** Strip emails, tokens, and other secrets before anything hits Discord. */
export function redactForDiscord(text: string): string {
  return (
    text
      .replace(/https?:\/\/[^\s<>)]+/gi, "")
      .replace(/\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}\b/g, "[redacted]")
      .replace(/\beyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\b/g, "[token]")
      .replace(/\b(Bearer\s+)[A-Za-z0-9._-]+/gi, "$1[token]")
      .replace(/\b(password|passwd|secret|api[_-]?key)[:\s=]+\S+/gi, "$1: [redacted]")
  );
}

const RAIN_FAIL =
  /join failed|join error|pipeline error|captcha|timeout|timed out|fail|error|wager required|wager requirement|limbo wager is off/i;

const RAIN_OK = /^joined rain$|^rain join summary$/i;

const RAIN_WAGER =
  /wager requirement|placing limbo|still need wager|limbo wager|limbo hit|limbo miss|limbo skipped after rain/i;

const RAIN_CAPTCHA = /rain captcha ready|solving rain captcha|sending rain join/i;

/** Default webhook feed: nickname + limbo + rain failures/joins/wagers only (no emails, no noise). */
export function shouldPostPublicDiscordAlert(log: ActivityLogRow, fullActivityFeed: boolean): boolean {
  if (fullActivityFeed) {
    if (log.category === "system" || log.category === "discord") return false;
    return true;
  }

  if (log.category === "limbo") {
    return /skipped|failed|error/i.test(log.message);
  }

  if (log.category === "rain") {
    const msg = log.message;
    if (/^joined rain$/i.test(msg)) return false;
    if (msg === "Rain join summary") return false;
    if (RAIN_OK.test(msg)) return true;
    if (RAIN_CAPTCHA.test(msg)) return false;
    if (RAIN_WAGER.test(msg)) return true;
    if (RAIN_FAIL.test(msg)) return true;
    return false;
  }

  return false;
}

export function formatPublicDiscordLine(
  log: ActivityLogRow,
  nickname: string | null,
  fullActivityFeed: boolean,
): string {
  const t = log.created_at.slice(11, 19);
  const who = nickname ? `**${redactForDiscord(nickname)}**` : "**?**";
  const message = redactForDiscord(log.message);
  let detail = log.detail?.trim();
  if (detail) {
    detail = redactForDiscord(detail);
    if (/^\S+@\S+\.\S+$/.test(detail)) detail = undefined;
  }

  if (log.category === "limbo") {
    const wager = detail ? ` · ${detail}` : "";
    return `\`${t}\` ${who} · ${message}${wager}`;
  }

  if (log.category === "rain") {
    if (/joined rain/i.test(log.message)) {
      return `\`${t}\` ${who} · Joined rain`;
    }
    const extra = detail ? ` · ${detail.split("\n")[0]!.slice(0, 180)}` : "";
    return `\`${t}\` ${who} · ${message}${extra}`;
  }

  if (fullActivityFeed) {
    const extra = detail ? `\n> ${detail.split("\n").join("\n> ").slice(0, 400)}` : "";
    return `\`${t}\` ${who} · **${log.category}** · ${message}${extra}`;
  }

  return `\`${t}\` ${who} · ${message}`;
}
