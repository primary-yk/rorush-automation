/** Auto-create private feed on server join (requires Server Members Intent). */

function envFlag(): string | undefined {
  return process.env.DISCORD_AUTO_CONNECT_ON_JOIN?.trim().toLowerCase();
}

/** Default OFF — members use `#connect` or `/connect`. Set `DISCORD_AUTO_CONNECT_ON_JOIN=1` to auto-create feeds on join. */
export function autoConnectFeedOnJoin(): boolean {
  const v = envFlag();
  if (v === "0" || v === "false" || v === "no" || v === "off") return false;
  if (v === "1" || v === "true" || v === "yes" || v === "on") return true;
  return false;
}
