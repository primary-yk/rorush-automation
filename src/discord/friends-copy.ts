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
    "1. **`/link link`** — opens your **private** rain & limbo thread",
    "2. **`/account add`** — save login (only you see it)",
    "3. **`/rain`** · **`/limbo`** · **`/cases`**",
    "",
    discordSupportLine(),
  ];
}

export function friendThreadWelcomeDescription(): string {
  return [
    "Rain joins, limbo wagers, and case opens for **your accounts** show up in this thread.",
    "",
    "Next: **`/account add`** → **`/rain account:… on:true`** → **`/limbo set`** if you need wager settings.",
    "",
    discordSupportLine(),
  ].join("\n");
}

export function friendStartHereChannelText(): string {
  return [
    "**Welcome**",
    "",
    "Automation runs from this Discord server — you do not install anything.",
    "",
    "1. **`/link link`** — private thread for your updates",
    "2. **`/account add`** — your login (ephemeral)",
    "3. **`/rain`** · **`/limbo`** · **`/cases`**",
    "",
    discordSupportLine(),
  ].join("\n");
}

export function friendCommandsChannelText(): string {
  return [
    "**Commands**",
    "• `/link link` — your private feed thread",
    "• `/account add` · `/account remove`",
    "• `/accounts` — balance & toggles",
    "• `/rain` · `/cases`",
    "• `/limbo set` · `/limbo test` · `/limbo filters`",
    "• `/status` · `/help`",
    "",
    discordSupportLine(),
  ].join("\n");
}
