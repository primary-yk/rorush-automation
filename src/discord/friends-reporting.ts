import { reloadEnv } from "../config.js";
import { isFriendsHostMode } from "./host-alerts.js";
import { friendsServerFeedActive } from "./friends-feed.js";

/** Slash bot on a single friends guild (not relay / SaaS). */
export function friendsGuildBotConfigured(): boolean {
  reloadEnv();
  if (!isFriendsHostMode()) return false;
  return !!(process.env.DISCORD_GUILD_ID?.trim() && process.env.DISCORD_BOT_TOKEN?.trim());
}

/** Opt-in: post rain/activity to DISCORD_REPORT_WEBHOOK instead of (or as well as) bot threads. */
export function legacyReportWebhookEnabled(): boolean {
  reloadEnv();
  const v = process.env.DISCORD_USE_REPORT_WEBHOOK?.trim().toLowerCase();
  return v === "1" || v === "true" || v === "yes" || v === "on";
}

/** Friends guild bots should use private threads + #host-log, not channel webhooks. */
export function preferFriendsBotFeedsOverWebhook(): boolean {
  return friendsGuildBotConfigured() && !legacyReportWebhookEnabled();
}

export function friendsAlertRoutingHint(): string {
  if (!friendsGuildBotConfigured()) return "webhook or relay";
  if (legacyReportWebhookEnabled()) return "webhook (legacy) + bot when configured";
  if (friendsServerFeedActive()) return "private feed threads + #host-log";
  return "run /server setup — webhook disabled until then";
}
