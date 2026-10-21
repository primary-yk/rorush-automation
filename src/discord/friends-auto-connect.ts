/** Auto-create private feed on server join (requires Server Members Intent). */

function envFlag(): string | undefined {
  return process.env.DISCORD_AUTO_CONNECT_ON_JOIN?.trim().toLowerCase();
}

function isFriendsGuildBot(): boolean {
  const guild = process.env.DISCORD_GUILD_ID?.trim();
  const relay = process.env.DISCORD_BOT_RELAY_URL?.trim();
  return Boolean(guild && !relay);
}

/** Default ON for friends guild bots. Set `DISCORD_AUTO_CONNECT_ON_JOIN=0` to require manual connect. */
export function autoConnectFeedOnJoin(): boolean {
  const v = envFlag();
  if (v === "0" || v === "false" || v === "no" || v === "off") return false;
  if (v === "1" || v === "true" || v === "yes" || v === "on") return true;
  return isFriendsGuildBot();
}
