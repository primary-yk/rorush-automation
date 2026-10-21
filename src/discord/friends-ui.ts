import { EmbedBuilder, type APIEmbedField } from "discord.js";
import { clampLimboMultiplier } from "../config.js";
import { enforceLimboMultiplierMinimums, listAccounts, type AccountRow } from "../db/repositories.js";
import { accountsForDiscordUser } from "./friends-commands.js";
import { countRainJoinsToday } from "../db/repositories.js";
import { vaultLockStatusLine } from "../automation/vault-lock-apply.js";
import { discordSupportLine } from "./friends-copy.js";
import { isAccountAutomationPaused } from "../accounts/account-automation.js";
import { appendSessionHintIfNeeded } from "./friends-auth-hints.js";
import {
  formatLifetimeShort,
  lifetimeBreakdown,
  lifetimeByDiscordOwner,
  sumLifetimeBreakdown,
} from "./friends-lifetime.js";

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
        value:
          "`/account add` · `/account session`\n`/account list` · `/account refresh` · pause · resume · remove\nAccount picks use **dropdowns** (your saved nicknames)",
        inline: true,
      },
      {
        name: "Automation",
        value:
          "`/rain` · `/cases`\n`/limbo` · `/account vault` · `/rorush vault` · `/rorush off`",
        inline: true,
      },
      {
        name: "Overview",
        value: "`/status` — engine online?\n`/earnings` — lifetime totals\n`/help` — this menu",
        inline: true,
      },
      {
        name: "Staff / owner",
        value:
          "`/server setup` · `/server earnings` · `/server tools`\n`/jump` · `/thread restore` · `/pause` · `/resume`\n`/owner backup` (host user id only)",
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
      {
        name: "Step 2",
        value:
          "`/account add` — email & password\n`/account session` — JWT from rorush.com (2FA / no password)",
        inline: false,
      },
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
        value: "`/account add` or `/account session` → `/rain account:… on:true`",
        inline: false,
      },
    );
}

export function buildStatusEmbed(): EmbedBuilder {
  const accounts = listAccounts();
  const withAccounts = new Set(accounts.map((a) => a.owner_discord_id).filter(Boolean));
  return baseEmbed(UI.primary)
    .setTitle("System status")
    .addFields(
      { name: "Engine", value: "Online", inline: true },
      { name: "Accounts", value: String(accounts.length), inline: true },
      { name: "Members", value: String(withAccounts.size), inline: true },
    );
}

function accountRowField(a: AccountRow): APIEmbedField {
  const bal = a.balance != null ? `${a.balance.toFixed(2)} coins` : "—";
  const vault = a.vault_balance != null ? `${a.vault_balance.toFixed(2)} coins` : "—";
  const lvl = a.level != null ? String(a.level) : "—";
  const toggles = [
    a.join_rain ? "Rain" : null,
    a.auto_open_cases ? "Cases" : null,
    a.auto_vault_deposit ? "Vault rain" : null,
    vaultLockStatusLine(a),
    a.limbo_wager_enabled ? `Limbo ${clampLimboMultiplier(a.limbo_multiplier).toFixed(2)}×` : null,
    a.pre_wager_before_rain ? "Pre-wager" : null,
    a.min_rain_amount > 0 ? `Min pool ${a.min_rain_amount.toFixed(0)}` : null,
  ]
    .filter(Boolean)
    .join(" · ") || "All automation off";
  const life = formatLifetimeShort(lifetimeBreakdown(a));
  const paused = isAccountAutomationPaused(a) ? "\n**Automation paused** — `/account resume` or staff override" : "";
  let value = `Wallet **${bal}** · Vault **${vault}** · Level **${lvl}**\n${life}\n${toggles}\nStatus: \`${a.status}\`${paused}`;
  value = appendSessionHintIfNeeded(value, a);
  return {
    name: a.nickname,
    value,
    inline: false,
  };
}

export function buildAccountsEmbed(discordUserId: string): EmbedBuilder {
  enforceLimboMultiplierMinimums();
  const accounts = accountsForDiscordUser(discordUserId);
  const embed = baseEmbed(UI.primary).setTitle("Your accounts");
  if (accounts.length === 0) {
    return embed.setDescription(
      "No accounts yet. Use `/account add` or `/account session` — only you see the reply.",
    );
  }
  const total = sumLifetimeBreakdown(accounts);
  const joinsToday = countRainJoinsToday(accounts.map((a) => a.id));
  return embed
    .addFields(accounts.slice(0, 7).map(accountRowField))
    .addFields(
      {
        name: "Rain joins today (UTC)",
        value: String(joinsToday),
        inline: true,
      },
      {
        name: "Your lifetime (all accounts)",
        value: formatLifetimeShort(total),
        inline: false,
      },
    );
}

export function buildPersonalEarningsEmbed(discordUserId: string): EmbedBuilder {
  const accounts = accountsForDiscordUser(discordUserId);
  const embed = baseEmbed(UI.accent).setTitle("Lifetime earnings").setDescription("Tracked on this host — rain, cases, and codes.");
  if (accounts.length === 0) {
    return embed.setDescription("No accounts linked to your Discord yet. Use `/account add` or `/account session`.");
  }
  const joinsToday = countRainJoinsToday(accounts.map((a) => a.id));
  const fields: APIEmbedField[] = accounts.slice(0, 10).map((a) => ({
    name: a.nickname,
    value: formatLifetimeShort(lifetimeBreakdown(a)),
    inline: false,
  }));
  fields.push({
    name: "Rain joins today (UTC)",
    value: String(joinsToday),
    inline: false,
  });
  const total = sumLifetimeBreakdown(accounts);
  fields.push({
    name: "Combined total",
    value: formatLifetimeShort(total),
    inline: false,
  });
  return embed.addFields(fields);
}

export function buildServerEarningsBoardEmbed(): EmbedBuilder {
  const accounts = listAccounts();
  const byOwner = lifetimeByDiscordOwner(accounts);
  const embed = baseEmbed(UI.primary)
    .setTitle("Lifetime earnings — all members")
    .setDescription("Discord accounts with saved logins on this host.");

  if (byOwner.size === 0) {
    return embed.addFields({
      name: "No linked members yet",
      value: "Totals appear after friends use `/account add` or `/account session`.",
      inline: false,
    });
  }

  const rows = [...byOwner.entries()].sort((a, b) => b[1].total - a[1].total);
  const lines = rows.slice(0, 20).map(([userId, b], i) => {
    const rank = i + 1;
    return `**${rank}.** <@${userId}> · **${b.total.toFixed(2)}** coins · rain ${b.rain.toFixed(2)} · cases ${b.cases.toFixed(2)} · codes ${b.codes.toFixed(2)}`;
  });

  const unowned = accounts.filter((a) => !a.owner_discord_id?.trim());
  if (unowned.length > 0) {
    const hostTotal = sumLifetimeBreakdown(unowned);
    lines.push("");
    lines.push(
      `_Host dashboard (${unowned.length} account(s)):_ **${hostTotal.total.toFixed(2)}** coins · rain ${hostTotal.rain.toFixed(2)} · cases ${hostTotal.cases.toFixed(2)} · codes ${hostTotal.codes.toFixed(2)}`,
    );
  }

  return embed.addFields({ name: "Members", value: lines.join("\n").slice(0, 1024), inline: false });
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

export function buildHostLogToolsEmbed(): EmbedBuilder {
  return baseEmbed(UI.accent)
    .setTitle("Host tools")
    .setDescription(
      "Check that **private feed threads** receive rain-style alerts.\n\n" +
        "**Test rain → my feed** — sample alert in **your** thread (run **`/connect`** first).\n" +
        "**Test rain → all feeds** — sample alert in every registered private feed.\n" +
        "**List open feeds** — who has a thread (ephemeral to you).\n\n" +
        "Member **connect** and **account** actions also post here automatically.",
    );
}

export function buildConnectChannelEmbed(): EmbedBuilder {
  return baseEmbed(UI.accent)
    .setTitle("Get your private feed")
    .setDescription(
      "You **don't** type `/connect` as a normal chat message — that won't work.\n\n" +
        "**Tap the button below**, or press **`/`** next to the message box → pick this bot → **`connect`**.\n\n" +
        "The bot replies privately. Rain and limbo updates then show in **your thread** under `#rain-feeds`.",
    );
}

export function buildStartHereEmbed(): EmbedBuilder {
  return baseEmbed(UI.primary)
    .setTitle("Welcome")
    .setDescription(
      "Open **`#connect`** and tap **Create my private feed**, or use **`/` → connect** anywhere in the server. Only you see the bot reply.",
    )
    .addFields(
      { name: "Start", value: "`#connect` button → `/account add` or `/account session`", inline: true },
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
      { name: "Account", value: "`/account add` · `/account session`", inline: true },
      { name: "Rain", value: "`/rain account:… on:true`", inline: true },
      { name: "Limbo", value: "`/limbo set` · `/limbo filters`", inline: true },
      supportField(),
    );
}

export function buildErrorEmbed(message: string): EmbedBuilder {
  return baseEmbed(UI.error).setTitle("Something went wrong").setDescription(message);
}

export function buildHostJumpEmbed(input: { threadId: string; targetTag: string }): EmbedBuilder {
  return baseEmbed(UI.accent)
    .setTitle("Joined private feed")
    .setDescription(`You were added to **${input.targetTag}**'s thread for support.`)
    .addFields(
      { name: "Thread", value: `<#${input.threadId}>`, inline: false },
      {
        name: "When you're done",
        value: "Leave the thread from Discord's thread menu — staff are not added to new feeds automatically.",
        inline: false,
      },
    );
}

export function buildThreadRestoreEmbed(input: {
  threadId: string;
  created: boolean;
  roleRefreshed: boolean;
  memberTag: string;
}): EmbedBuilder {
  const lines = [
    `**${input.memberTag}**`,
    input.created ? "Created a **new** private feed thread." : "Re-added to their **existing** feed thread.",
    input.roleRefreshed ? "Rain Member role refreshed." : "",
    `Open: <#${input.threadId}>`,
  ].filter(Boolean);
  return baseEmbed(UI.success).setTitle("Member feed restored").setDescription(lines.join("\n"));
}
