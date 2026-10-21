import { EmbedBuilder, type APIEmbedField } from "discord.js";
import { listAccounts, type AccountRow } from "../db/repositories.js";
import { accountsForDiscordUser } from "./friends-commands.js";
import { discordSupportLine } from "./friends-copy.js";

/** Friend-facing Discord palette (no product name). */
export const UI = {
  primary: 0x5b_21_b6,
  accent: 0x0e_a5_e9,
  success: 0x05_96_69,
  warn: 0xd9_77_06,
  error: 0xdc_26_26,
  muted: 0x47_55_69,
} as const;

function footerSupport(): string {
  return discordSupportLine().replace(/\*\*/g, "");
}

function baseEmbed(color: number): EmbedBuilder {
  return new EmbedBuilder().setColor(color).setTimestamp().setFooter({ text: footerSupport() });
}

export function supportField(): APIEmbedField {
  return { name: "Need help?", value: discordSupportLine(), inline: false };
}

export function buildHelpEmbed(): EmbedBuilder {
  return baseEmbed(UI.primary)
    .setTitle("Command reference")
    .setDescription("Slash commands are **only visible to you** unless noted.")
    .addFields(
      {
        name: "Setup",
        value: "`/link link` — private feed\n`/account add` · `/account remove`",
        inline: true,
      },
      {
        name: "Automation",
        value: "`/rain` · `/cases`\n`/limbo set` · `/limbo test` · `/limbo filters`",
        inline: true,
      },
      {
        name: "Overview",
        value: "`/accounts` — balances & toggles\n`/status` · `/link guide`",
        inline: true,
      },
    );
}

export function buildSetupGuideEmbed(): EmbedBuilder {
  return baseEmbed(UI.accent)
    .setTitle("Link guide")
    .setDescription("Everything runs from this server — nothing to install.")
    .addFields(
      { name: "1", value: "`/link link` — your private rain & limbo thread", inline: false },
      { name: "2", value: "`/account add` — login (ephemeral, only you see it)", inline: false },
      { name: "3", value: "`/rain` · `/limbo` · `/cases` — turn features on/off", inline: false },
      supportField(),
    );
}

export function buildSetupJoinEmbed(input: {
  threadId: string;
  created: boolean;
}): EmbedBuilder {
  const title = input.created ? "Private feed ready" : "Private feed linked";
  return baseEmbed(UI.success)
    .setTitle(title)
    .setDescription(`Your updates live in <#${input.threadId}>.`)
    .addFields(
      {
        name: "What shows there",
        value: "Rain joins, limbo wagers, and case opens for **your** accounts.",
        inline: false,
      },
      {
        name: "Next steps",
        value: "`/account add` → `/rain account:… on:true`",
        inline: false,
      },
      { name: "Reference", value: "See `#commands` for the full list.", inline: false },
    );
}

export function buildStatusEmbed(): EmbedBuilder {
  const accounts = listAccounts();
  const linked = new Set(accounts.map((a) => a.owner_discord_id).filter(Boolean));
  return baseEmbed(UI.primary)
    .setTitle("System status")
    .addFields(
      { name: "Engine", value: "Online", inline: true },
      { name: "Accounts", value: String(accounts.length), inline: true },
      { name: "Linked users", value: String(linked.size), inline: true },
    );
}

function accountRowField(a: AccountRow): APIEmbedField {
  const bal = a.balance != null ? `${a.balance.toFixed(2)} coins` : "—";
  const lvl = a.level != null ? String(a.level) : "—";
  const toggles = [
    a.join_rain ? "Rain" : null,
    a.auto_open_cases ? "Cases" : null,
    a.limbo_wager_enabled ? `Limbo ${a.limbo_multiplier.toFixed(2)}×` : null,
    a.pre_wager_before_rain ? "Pre-wager" : null,
    a.min_rain_amount > 0 ? `Min pool ${a.min_rain_amount.toFixed(0)}` : null,
  ]
    .filter(Boolean)
    .join(" · ") || "All automation off";
  return {
    name: a.nickname,
    value: `Balance **${bal}** · Level **${lvl}**\n${toggles}\nStatus: \`${a.status}\``,
    inline: false,
  };
}

export function buildAccountsEmbed(discordUserId: string): EmbedBuilder {
  const accounts = accountsForDiscordUser(discordUserId);
  const embed = baseEmbed(UI.primary).setTitle("Your accounts");
  if (accounts.length === 0) {
    return embed.setDescription("No accounts linked yet. Use `/account add` — only you see the password.");
  }
  return embed.addFields(accounts.slice(0, 8).map(accountRowField));
}

export function buildUpdateEmbed(input: {
  title: string;
  lines: string[];
  ok?: boolean;
}): EmbedBuilder {
  const color = input.ok === false ? UI.error : UI.success;
  return baseEmbed(color)
    .setTitle(input.title)
    .setDescription(input.lines.join("\n"));
}

export function buildPlainResultEmbed(description: string, ok = true): EmbedBuilder {
  return buildUpdateEmbed({ title: ok ? "Done" : "Could not complete", lines: [description], ok });
}

export function buildSetupServerEmbed(summaryLines: string[]): EmbedBuilder {
  const body = summaryLines.filter((l) => l.trim().length > 0);
  const title = body.shift() ?? "Server layout";
  const fields: APIEmbedField[] = [];
  for (const line of body) {
    if (!line.trim()) continue;
    const cleaned = line.replace(/\*\*/g, "");
    if (cleaned.length < 80 && !cleaned.includes("→")) {
      fields.push({ name: "\u200b", value: line, inline: false });
    } else {
      fields.push({ name: "\u200b", value: line, inline: false });
    }
  }
  return baseEmbed(UI.success).setTitle(title.replace(/\*\*/g, "")).addFields(fields.slice(0, 12));
}

export function buildStartHereEmbed(): EmbedBuilder {
  return baseEmbed(UI.primary)
    .setTitle("Welcome")
    .setDescription("Rain automation for this server — controlled from Discord.")
    .addFields(
      { name: "Start", value: "`/link link` then `/account add`", inline: true },
      { name: "Automate", value: "`/rain` · `/limbo` · `/cases`", inline: true },
      supportField(),
    );
}

export function buildCommandsChannelEmbed(): EmbedBuilder {
  return buildHelpEmbed().setTitle("Commands").setFooter({ text: footerSupport() });
}

export function buildThreadWelcomeEmbed(): EmbedBuilder {
  return baseEmbed(UI.primary)
    .setTitle("Private feed")
    .setDescription("This thread is **yours only** — rain, limbo, and case activity land here.")
    .addFields(
      { name: "1 · Account", value: "`/account add`", inline: true },
      { name: "2 · Rain", value: "`/rain account:… on:true`", inline: true },
      { name: "3 · Limbo", value: "`/limbo set` · `/limbo filters`", inline: true },
      supportField(),
    );
}

export function buildErrorEmbed(message: string): EmbedBuilder {
  return baseEmbed(UI.error).setTitle("Something went wrong").setDescription(message);
}
