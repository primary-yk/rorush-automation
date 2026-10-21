/** Friend-visible Discord text — no product name, no “host PC” wording. */

export function discordSupportMention(): string {
  const v = process.env.DISCORD_SUPPORT_MENTION?.trim();
  return v || "@28ub";
}

export function discordSupportLine(): string {
  return `Issues? Ping **${discordSupportMention()}**.`;
}

export function friendSetupGuideLines(): string[] {
  return [
    "**Getting started**",
    "",
    "1. **`/connect`** — private rain & limbo feed thread",
    "2. **`/account add`** — save login (only you see it)",
    "3. **`/rain`** · **`/limbo`** · **`/cases`**",
    "",
    discordSupportLine(),
  ];
}

export function friendStartHereChannelText(): string {
  return [
    "**Welcome**",
    "",
    "Automation runs from this Discord server.",
    "",
    "1. **`/connect`** — your private feed thread",
    "2. **`/account add`** — login (ephemeral)",
    "3. **`/rain`** · **`/limbo`** · **`/cases`**",
    "",
    discordSupportLine(),
  ].join("\n");
}

export function friendCommandsChannelText(): string {
  return [
    "**Commands**",
    "• `/connect` — private feed",
    "• `/guide` — getting started",
    "• `/account add` · `/account remove` · `/account list`",
    "• `/rain` · `/cases` · `/limbo`",
    "• `/status` · `/help`",
    "",
    discordSupportLine(),
  ].join("\n");
}
