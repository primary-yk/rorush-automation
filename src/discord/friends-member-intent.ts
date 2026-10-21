/** Privileged intent — must be enabled in Discord Developer Portal. */

function envFlag(): string | undefined {
  return process.env.DISCORD_SERVER_MEMBERS_INTENT?.trim().toLowerCase();
}

function isFriendsGuildBot(): boolean {
  const guild = process.env.DISCORD_GUILD_ID?.trim();
  const relay = process.env.DISCORD_BOT_RELAY_URL?.trim();
  return Boolean(guild && !relay);
}

/** Explicit `DISCORD_SERVER_MEMBERS_INTENT=0` — bot connects without GuildMembers. */
export function serverMembersIntentOptedOut(): boolean {
  const v = envFlag();
  return v === "0" || v === "false" || v === "no" || v === "off";
}

/**
 * Request GuildMembers on the Discord gateway.
 * Default **ON** for friends guild bots (DISCORD_GUILD_ID, no relay) so Portal intent alone is enough after restart.
 * Set `DISCORD_SERVER_MEMBERS_INTENT=0` if the Portal toggle is off.
 */
export function useServerMembersIntent(): boolean {
  if (serverMembersIntentOptedOut()) return false;
  const v = envFlag();
  if (v === "1" || v === "true" || v === "yes" || v === "on") return true;
  return isFriendsGuildBot();
}

export function serverMembersIntentHelp(): string {
  return (
    "Enable **Server Members Intent** in the Discord Developer Portal (Bot → Privileged Gateway Intents), " +
    "then restart `npm run dev`. Friends guild bots opt in automatically unless `DISCORD_SERVER_MEMBERS_INTENT=0`."
  );
}
