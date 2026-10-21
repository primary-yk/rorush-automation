/** Friend-visible Discord text — no product name, no “host PC” wording. */

export function discordSupportMention(): string {
  const v = process.env.DISCORD_SUPPORT_MENTION?.trim();
  return v || "@28ub";
}

export function discordSupportLine(): string {
  return `Need help? Contact **${discordSupportMention()}**.`;
}

export function friendSetupGuideLines(): string[] {
  return [
    "**Setup guide**",
    "",
    "1. **`#connect`** → **Create my private feed** (or **`/connect`**) ",
    "2. **`/account add`** or **`/account session`** — link RoRush (private reply)",
    "3. **`/dashboard`** — enable rain, cases, and limbo with buttons",
    "",
    discordSupportLine(),
  ];
}

export function friendStartHereChannelText(): string {
  return [
    "**Welcome**",
    "",
    "Rain automation runs from this Discord server — no install required.",
    "",
    "1. **`#connect`** — private feed thread",
    "2. **`/account add`** or **`/account session`**",
    "3. **`/dashboard`** — one-tap controls",
    "",
    discordSupportLine(),
  ].join("\n");
}

export function friendCommandsChannelText(): string {
  return [
    "**Commands**",
    "• `/connect` · `/guide` · `/dashboard`",
    "• `/account add` · `/account session` · `/account list`",
    "• `/rain` · `/cases` · `/limbo`",
    "• `/earnings` · `/status` · `/help`",
    "",
    discordSupportLine(),
  ].join("\n");
}
