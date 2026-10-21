/** Privileged intent — must be enabled in Discord Developer Portal. Off by default so the bot always connects. */
export function useServerMembersIntent(): boolean {
  const v = process.env.DISCORD_SERVER_MEMBERS_INTENT?.trim().toLowerCase();
  return v === "1" || v === "true" || v === "yes" || v === "on";
}

export function serverMembersIntentHelp(): string {
  return (
    "Enable **Server Members Intent** in the Discord Developer Portal (Bot → Privileged Gateway Intents), " +
    "then set `DISCORD_SERVER_MEMBERS_INTENT=1` in `.env` and restart `npm run dev`."
  );
}
