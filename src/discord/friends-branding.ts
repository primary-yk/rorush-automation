import { isFriendsHostMode } from "./host-alerts.js";

/** Product name on Discord embeds (host webhook / legacy). Friends mode defaults off. */
export function friendsDiscordBrandingEnabled(): boolean {
  if (!isFriendsHostMode()) return true;
  const v = process.env.DISCORD_SHOW_PRODUCT_NAME?.trim().toLowerCase();
  return v === "1" || v === "true" || v === "yes" || v === "on";
}
