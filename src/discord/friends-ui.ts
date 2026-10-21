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
    .setDescription("Replies are **ephemeral** — only you see them.")
    .addFields(
      {
        name: "Onboarding",
        value: "`/connect` — private feed thread\n`/guide` — getting started",
        inline: true,
      },
      {
        name: "Accounts",
        value: "`/account add` · `/account remove`\n`/account list`",
        inline: true,
      },
      {
        name: "Automation",
        value: "`/rain` · `/cases`\n`/limbo set` · `/limbo test` · `/limbo filters`",
        inline: true,
      },
      {
        name: "Overview",
        value: "`/status` — engine online?\n`/help` — this menu",
        inline: true,
      },
      {
        name: "Staff",
        value: "`/server setup` · `/pause` · `/resume`",
        inline: true,
      },
    );
}

export function buildSetupGuideEmbed(): EmbedBuilder {
  return baseEmbed(UI.accent)
    .setTitle("Getting started")
    .setDescription("Use this server to run rain automation — nothing to install.")
    .addFields(
      { name: "Step 1", value: "`/connect` — opens your **private** feed thread", inline: false },
      { name: "Step 2", value: "`/account add` — RoRush login (ephemeral)", inline: false },
      { name: "Step 3", value: "`/rain` · `/limbo` · `/cases` — enable features", inline: false },
      supportField(),
    );
}

export function buildSetupJoinEmbed(input: {
  threadId: string;
  created: boolean;
}): EmbedBuilder {
  const title = input.created ? "Connected" : "Already connected";
  return baseEmbed(UI.success)
    .setTitle(title)
    .setDescription(`Your feed: <#${input.threadId}>`)
    .addFields(
      {
        name: "Updates here",
        value: "Rain joins, limbo wagers, and case opens for your accounts.",
        inline: false,
      },
      {
        name: "Next",
        value: "`/account add` → `/rain account:… on:true`",
        inline: false,
      },
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
    return embed.setDescription("No accounts yet. Use `/account add` — only you see the password.");
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
  return buildUpdateEmbed({ title: ok ? "Updated" : "Could not complete", lines: [description], ok });
}

export function buildSetupServerEmbed(summaryLines: string[]): EmbedBuilder {
  const body = summaryLines.filter((l) => l.trim().length > 0);
  const title = body.shift()?.replace(/\*\*/g, "") ?? "Server layout";
  const fields: APIEmbedField[] = body
    .filter((l) => l.trim())
    .map((line) => ({ name: "\u200b", value: line, inline: false }));
  return baseEmbed(UI.success).setTitle(title).addFields(fields.slice(0, 12));
}

export function buildStartHereEmbed(): EmbedBuilder {
  return baseEmbed(UI.primary)
    .setTitle("Welcome")
    .setDescription("Rain automation for this server.")
    .addFields(
      { name: "Start", value: "`/connect` then `/account add`", inline: true },
      { name: "Automate", value: "`/rain` · `/limbo` · `/cases`", inline: true },
      { name: "Help", value: "`/guide` · `/help`", inline: true },
      supportField(),
    );
}

export function buildCommandsChannelEmbed(): EmbedBuilder {
  return buildHelpEmbed().setTitle("Commands").setFooter({ text: footerSupport() });
}

export function buildThreadWelcomeEmbed(): EmbedBuilder {
  return baseEmbed(UI.primary)
    .setTitle("Private feed")
    .setDescription("Rain, limbo, and case updates for **your accounts** appear in this thread.")
    .addFields(
      { name: "Account", value: "`/account add`", inline: true },
      { name: "Rain", value: "`/rain account:… on:true`", inline: true },
      { name: "Limbo", value: "`/limbo set` · `/limbo filters`", inline: true },
      supportField(),
    );
}

export function buildErrorEmbed(message: string): EmbedBuilder {
  return baseEmbed(UI.error).setTitle("Something went wrong").setDescription(message);
}
