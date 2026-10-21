import type { ActivityLogRow } from "./public-alert-filter.js";

/** Activity that should only appear in #host-log / host DMs — not private member feeds. */
export function isHostOnlyActivityLog(log: ActivityLogRow): boolean {
  if (log.category === "system") return true;
  const text = `${log.message} ${log.detail ?? ""}`;
  if (/vault deposit failed|could not refresh|session expired|unhandled worker/i.test(text)) return true;
  if (/skipped \(pool below|limbo skipped|auto vault off|profit .* below minimum|below minimum/i.test(text)) {
    return false;
  }
  return /fail|error|captcha|timeout|expired|invalid|could not|denied|\b401\b|\b403\b|HTTP \d{3}/i.test(text);
}
