import { isFriendsHostMode } from "./host-alerts.js";

/** Product name on Discord embeds (host webhook / legacy). Friends mode defaults off. */
export function friendsDiscordBrandingEnabled(): boolean {
  if (!isFriendsHostMode()) return true;
  const v = process.env.DISCORD_SHOW_PRODUCT_NAME?.trim().toLowerCase();
  return v === "1" || v === "true" || v === "yes" || v === "on";
}

/** Discord presence line after "Watching" (max 128 chars). */
export function botWatchingPresenceName(): string {
  const v = process.env.DISCORD_BOT_WATCHING?.trim();
  const name = v || "@JacobFuture Khecker";
  return name.slice(0, 128);
}
