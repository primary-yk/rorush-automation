import { encryptField, decryptField } from "../accounts/session-manager.js";
import { reloadEnv } from "../config.js";
import { getSettings, updateSettings } from "../db/repositories.js";

export function isValidDiscordWebhookUrl(url: string): boolean {
  return /discord(?:app)?\.com\/api\/webhooks\//i.test(url);
}

/** Webhook from `.env` (wins) or encrypted value in settings when reporting is enabled. */
export function resolveDiscordReportWebhookUrl(): string | null {
  reloadEnv();
  const fromEnv = process.env.DISCORD_REPORT_WEBHOOK?.trim();
  if (fromEnv && isValidDiscordWebhookUrl(fromEnv)) return fromEnv;

  const s = getSettings();
  if (!s.discord_report_enabled || !s.discord_report_webhook_enc) return null;
  let url: string | null = null;
  try {
    url = decryptField(s.discord_report_webhook_enc);
  } catch {
    return null;
  }
  if (!url || !isValidDiscordWebhookUrl(url)) return null;
  return url;
}

/** Persist `DISCORD_REPORT_WEBHOOK` from `.env` into the DB (encrypted) on startup. */
export function applyDiscordWebhookFromEnv(): void {
  reloadEnv();
  const url = process.env.DISCORD_REPORT_WEBHOOK?.trim();
  if (!url) return;
  if (!isValidDiscordWebhookUrl(url)) {
    console.warn("[discord] DISCORD_REPORT_WEBHOOK ignored — paste the full channel webhook URL from Discord.");
    return;
  }
  const s = getSettings();
  let existing: string | null = null;
  if (s.discord_report_webhook_enc) {
    try {
      existing = decryptField(s.discord_report_webhook_enc);
    } catch {
      existing = null;
    }
  }
  if (existing === url && s.discord_report_enabled) return;

  const enc = encryptField(url);
  if (!enc) {
    console.warn("[discord] Set ENCRYPTION_KEY in .env before saving DISCORD_REPORT_WEBHOOK.");
    return;
  }
  updateSettings({
    discord_report_enabled: 1,
    discord_report_webhook_enc: enc,
  });
  console.log("[discord] Alerts webhook loaded from .env — rain/errors will post when the engine runs.");
}
