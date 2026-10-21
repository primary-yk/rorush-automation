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
import { formatSessionHealthPanel } from "./friends-session-health.js";

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
  return { name: "Support", value: discordSupportLine(), inline: false };
}

export function buildHelpEmbed(): EmbedBuilder {
  return baseEmbed(UI.primary)
    .setTitle("Command center")
    .setDescription(
      "Every reply is **private** (only you see it). Use the buttons below to jump between views without retyping commands.",
    )
    .addFields(
      {
        name: "Start here",
        value:
          "`/connect` — private activity feed\n`/guide` — setup walkthrough\n`/dashboard` — balances, session health, controls",
        inline: false,
      },
      {
        name: "Accounts",
        value:
          "`/account add` — email & password\n`/account session` — browser JWT (2FA)\n`/account list` — stats + buttons\n`/account refresh` · pause · resume · remove",
        inline: false,
      },
      {
        name: "Automation",
        value:
          "`/rain` · `/cases` — per-account toggles\n`/limbo set` — wager multiplier & bet\n`/limbo filters` — min pool & pre-wager\n`/account vault` · `/rorush vault` — vault options",
        inline: false,
      },
      {
        name: "Insights",
        value: "`/earnings` — lifetime totals\n`/status` — engine health\n`/help` — this panel",
        inline: false,
      },
      {
        name: "Staff",
        value:
          "`/server setup` · `/server earnings` · `/server tools`\n`/jump` · `/thread restore` · `/pause` · `/resume`\n`/owner backup` — host owner only",
        inline: false,
      },
    );
}

export function buildSetupGuideEmbed(): EmbedBuilder {
  return baseEmbed(UI.accent)
    .setTitle("Setup guide")
    .setDescription("Three steps — no install. Your rain and limbo alerts land in a **private thread**.")
    .addFields(
      {
        name: "1 · Private feed",
        value: "Run **`/connect`** (or use the button in **`#connect`**). You get a thread only you and staff can open.",
        inline: false,
      },
      {
        name: "2 · Link RoRush",
        value:
          "**`/account add`** — email & password\n**`/account session`** — paste session JWT from the site (best for 2FA)",
        inline: false,
      },
      {
        name: "3 · Enable automation",
        value:
          "Open **`/dashboard`** and use **Rain · On**, **Cases**, and **Limbo** — or use **`/rain`**, **`/cases`**, **`/limbo set`**.",
        inline: false,
      },
      supportField(),
    );
}

export function buildSetupJoinEmbed(input: {
  threadId: string;
  created: boolean;
}): EmbedBuilder {
  const title = input.created ? "Feed connected" : "Already connected";
  return baseEmbed(UI.success)
    .setTitle(title)
    .setDescription(`Your private thread: <#${input.threadId}>`)
    .addFields(
      {
        name: "What posts here",
        value: "Rain joins, limbo results, case opens, and vault moves for **your** nicknames.",
        inline: false,
      },
      {
        name: "Recommended next step",
        value: "**`/account add`** or **`/account session`**, then **`/dashboard`** to turn on rain.",
        inline: false,
      },
    );
}

export function buildStatusEmbed(): EmbedBuilder {
  const accounts = listAccounts();
  const withAccounts = new Set(accounts.map((a) => a.owner_discord_id).filter(Boolean));
  return baseEmbed(UI.primary)
    .setTitle("Host status")
    .setDescription("Automation engine snapshot for this server.")
    .addFields(
      { name: "Engine", value: "● Online", inline: true },
      { name: "Saved accounts", value: String(accounts.length), inline: true },
      { name: "Linked members", value: String(withAccounts.size), inline: true },
    );
}

function automationSummary(a: AccountRow): string {
  const parts = [
    a.join_rain ? "**Rain**" : null,
    a.auto_open_cases ? "**Cases**" : null,
    a.auto_vault_deposit ? "**Vault profit**" : null,
    vaultLockStatusLine(a),
    a.limbo_wager_enabled
      ? `**Limbo** ${clampLimboMultiplier(a.limbo_multiplier).toFixed(2)}×`
      : null,
    a.pre_wager_before_rain ? "**Pre-wager**" : null,
    a.min_rain_amount > 0 ? `Min pool **${a.min_rain_amount.toFixed(0)}**` : null,
  ].filter(Boolean);
  return parts.length ? parts.join(" · ") : "_No automation enabled_";
}

function accountRowField(a: AccountRow): APIEmbedField {
  const bal = a.balance != null ? a.balance.toFixed(2) : "—";
  const vault = a.vault_balance != null ? a.vault_balance.toFixed(2) : "—";
  const lvl = a.level != null ? String(a.level) : "—";
  const life = formatLifetimeShort(lifetimeBreakdown(a));
  const paused = isAccountAutomationPaused(a)
    ? "\n\n**Account paused** — resume from the dashboard or **`/account resume`**."
    : "";
  let value = [
    `**Wallet** ${bal} · **Vault** ${vault} · **Level** ${lvl}`,
    `**Lifetime** ${life}`,
    `**Automation** ${automationSummary(a)}`,
    `**Connection** \`${a.status}\``,
  ].join("\n");
  value = appendSessionHintIfNeeded(value + paused, a);
  return {
    name: a.nickname,
    value,
    inline: false,
  };
}

export function buildAccountsEmbed(discordUserId: string): EmbedBuilder {
  enforceLimboMultiplierMinimums();
  const accounts = accountsForDiscordUser(discordUserId);
  const embed = baseEmbed(UI.primary).setTitle("Account overview");
  if (accounts.length === 0) {
    return embed.setDescription(
      "No accounts linked yet.\n\nUse **`/account add`** (email & password) or **`/account session`** (JWT). Replies stay private.",
    );
  }
  const total = sumLifetimeBreakdown(accounts);
  const joinsToday = countRainJoinsToday(accounts.map((a) => a.id));
  return embed
    .setDescription("Live balances and automation state. Use the controls below to change settings.")
    .addFields(
      {
        name: "Session health",
        value: formatSessionHealthPanel(accounts),
        inline: false,
      },
    )
    .addFields(accounts.slice(0, 7).map(accountRowField))
    .addFields(
      {
        name: "Rain joins today (UTC)",
        value: String(joinsToday),
        inline: true,
      },
      {
        name: "Combined lifetime",
        value: formatLifetimeShort(total),
        inline: false,
      },
    );
}

export function buildPersonalEarningsEmbed(discordUserId: string): EmbedBuilder {
  const accounts = accountsForDiscordUser(discordUserId);
  const embed = baseEmbed(UI.accent)
    .setTitle("Your earnings")
    .setDescription("Lifetime totals tracked on this host — rain, cases, and promo codes.");
  if (accounts.length === 0) {
    return embed.setDescription(
      "No accounts linked to your Discord yet.\n\nLink one with **`/account add`** or **`/account session`**, then check back here.",
    );
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
    inline: true,
  });
  const total = sumLifetimeBreakdown(accounts);
  fields.push({
    name: "All accounts combined",
    value: formatLifetimeShort(total),
    inline: false,
  });
  return embed.addFields(fields);
}

export function buildServerEarningsBoardEmbed(): EmbedBuilder {
  const accounts = listAccounts();
  const byOwner = lifetimeByDiscordOwner(accounts);
  const embed = baseEmbed(UI.primary)
    .setTitle("Member earnings")
    .setDescription("Lifetime totals for every Discord member with a saved login on this host.");

  if (byOwner.size === 0) {
    return embed.addFields({
      name: "No data yet",
      value: "Totals appear after members run **`/account add`** or **`/account session`**.",
      inline: false,
    });
  }

  const rows = [...byOwner.entries()].sort((a, b) => b[1].total - a[1].total);
  const lines = rows.slice(0, 20).map(([userId, b], i) => {
    const rank = i + 1;
    return `**${rank}.** <@${userId}> — **${b.total.toFixed(2)}** coins _(rain ${b.rain.toFixed(2)} · cases ${b.cases.toFixed(2)} · codes ${b.codes.toFixed(2)})_`;
  });

  const unowned = accounts.filter((a) => !a.owner_discord_id?.trim());
  if (unowned.length > 0) {
    const hostTotal = sumLifetimeBreakdown(unowned);
    lines.push("");
    lines.push(
      `_Unassigned host accounts (${unowned.length}):_ **${hostTotal.total.toFixed(2)}** coins · rain ${hostTotal.rain.toFixed(2)} · cases ${hostTotal.cases.toFixed(2)} · codes ${hostTotal.codes.toFixed(2)}`,
    );
  }

  return embed.addFields({ name: "Leaderboard", value: lines.join("\n").slice(0, 1024), inline: false });
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

export function buildPlainResultEmbed(description: string, ok = true, title?: string): EmbedBuilder {
  const defaultTitle = ok ? "Success" : "Could not complete";
  return buildUpdateEmbed({
    title: title ?? defaultTitle,
    lines: [description],
    ok,
  });
}

export function inferResultEmbedTitle(text: string, ok: boolean): string {
  if (!ok) return "Action required";
  if (/saved \*\*|session login/i.test(text)) return "Account linked";
  if (/removed \*\*/i.test(text)) return "Account removed";
  if (/join rain|auto cases|limbo wager|min rain pool|auto vault|vault automation/i.test(text)) {
    return "Settings updated";
  }
  if (/refreshed balance/i.test(text)) return "Balances refreshed";
  if (/automation \*\*paused\*\*|automation \*\*resumed\*\*/i.test(text)) return "Automation status";
  if (/test limbo/i.test(text)) return "Limbo test complete";
  return "Success";
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
    .setTitle("Host diagnostics")
    .setDescription("Verify that private feed threads receive automation cards.")
    .addFields(
      {
        name: "Rain sample",
        value: "**Test rain → my feed** — sample join card in **your** thread (run **`/connect`** first).\n**Test rain → all feeds** — broadcast sample to every registered thread.",
        inline: false,
      },
      {
        name: "Cases sample",
        value: "**Test daily case → my feed** — sample daily case card (matches live opens).",
        inline: false,
      },
      {
        name: "Feeds",
        value: "**List open feeds** — ephemeral list of connected members.\nMissing buttons? Run **`/server tools`** to repost this panel.",
        inline: false,
      },
      {
        name: "Live activity",
        value: "Member **connect** and **account** events also log here automatically.",
        inline: false,
      },
    );
}

export function buildConnectChannelEmbed(): EmbedBuilder {
  return baseEmbed(UI.accent)
    .setTitle("Connect your feed")
    .setDescription(
      "Slash commands do not work as normal chat text. Use the **button below** or the command picker: **`/`** → this bot → **`connect`**.",
    )
    .addFields({
      name: "After connecting",
      value: "Rain, limbo, and case updates appear in **your private thread** under **`#rain-feeds`**.",
      inline: false,
    });
}

export function buildStartHereEmbed(): EmbedBuilder {
  return baseEmbed(UI.primary)
    .setTitle("Welcome")
    .setDescription(
      "This server runs rain automation for linked RoRush accounts. Everything sensitive is **ephemeral** — only you see bot replies.",
    )
    .addFields(
      { name: "Step 1", value: "**`#connect`** → **Create my private feed**", inline: true },
      { name: "Step 2", value: "**`/account add`** or **`/account session`**", inline: true },
      { name: "Step 3", value: "**`/dashboard`** → enable rain", inline: true },
      { name: "Help", value: "**`/guide`** · **`/help`**", inline: true },
      supportField(),
    );
}

export function buildCommandsChannelEmbed(): EmbedBuilder {
  return buildHelpEmbed().setTitle("Commands").setFooter({ text: footerSupport() });
}

export function buildThreadWelcomeEmbed(): EmbedBuilder {
  return baseEmbed(UI.primary)
    .setTitle("Your private feed")
    .setDescription("This thread shows automation events for **your** saved accounts only.")
    .addFields(
      { name: "Accounts", value: "`/account add` · `/account session`", inline: true },
      { name: "Controls", value: "`/dashboard` · `/rain` · `/cases`", inline: true },
      { name: "Limbo", value: "`/limbo set` · `/limbo filters`", inline: true },
      supportField(),
    );
}

export function buildErrorEmbed(message: string): EmbedBuilder {
  return baseEmbed(UI.error).setTitle("Something went wrong").setDescription(message);
}

export function buildHostJumpEmbed(input: { threadId: string; targetTag: string }): EmbedBuilder {
  return baseEmbed(UI.accent)
    .setTitle("Support access granted")
    .setDescription(`You were added to **${input.targetTag}**'s private feed for troubleshooting.`)
    .addFields(
      { name: "Thread", value: `<#${input.threadId}>`, inline: false },
      {
        name: "When finished",
        value: "Leave the thread from Discord's thread menu. Staff are not auto-added to new member feeds.",
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
    `Member **${input.memberTag}**`,
    input.created
      ? "A **new** private feed thread was created."
      : "Re-added to their **existing** feed thread.",
    input.roleRefreshed ? "Rain Member role refreshed." : "",
    `Thread: <#${input.threadId}>`,
  ].filter(Boolean);
  return baseEmbed(UI.success).setTitle("Feed restored").setDescription(lines.join("\n"));
}
