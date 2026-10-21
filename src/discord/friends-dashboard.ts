import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  StringSelectMenuBuilder,
  type MessageActionRowComponentBuilder,
  type MessageComponentInteraction,
  type StringSelectMenuInteraction,
} from "discord.js";
import { isAccountAutomationPaused } from "../accounts/account-automation.js";
import { getAccount } from "../db/repositories.js";
import { engine } from "../worker/engine.js";
import {
  accountsForDiscordUser,
  setAccountAutomationPaused,
  setToggle,
} from "./friends-commands.js";
import { deferEphemeral, replyEphemeralEmbeds } from "./friends-interaction.js";
import { buildAccountsEmbed, buildPlainResultEmbed } from "./friends-ui.js";

export const DASHBOARD_PREFIX = "friends:dash:";

export function isDashboardComponent(customId: string): boolean {
  return customId.startsWith(DASHBOARD_PREFIX);
}

function parseAccountIdFromSuffix(suffix: string): number | null {
  const id = Number(suffix);
  return Number.isFinite(id) && id > 0 ? id : null;
}

export function dashboardAccountIdFromCustomId(customId: string): number | null {
  if (!customId.startsWith(DASHBOARD_PREFIX)) return null;
  const rest = customId.slice(DASHBOARD_PREFIX.length);
  const parts = rest.split(":");
  const last = parts[parts.length - 1];
  return parseAccountIdFromSuffix(last ?? "");
}

function assertOwnedAccount(discordUserId: string, accountId: number) {
  const row = getAccount(accountId);
  if (!row || row.owner_discord_id !== discordUserId) return null;
  return row;
}

export function buildAccountDashboardComponents(
  discordUserId: string,
  focusAccountId: number,
): ActionRowBuilder<MessageActionRowComponentBuilder>[] {
  const accounts = accountsForDiscordUser(discordUserId);
  const focus = accounts.find((a) => a.id === focusAccountId) ?? accounts[0];
  if (!focus) return [];

  const rows: ActionRowBuilder<MessageActionRowComponentBuilder>[] = [];

  if (accounts.length > 1) {
    rows.push(
      new ActionRowBuilder<MessageActionRowComponentBuilder>().addComponents(
        new StringSelectMenuBuilder()
          .setCustomId(`${DASHBOARD_PREFIX}account-select`)
          .setPlaceholder(`Account · ${focus.nickname}`)
          .addOptions(
            accounts.slice(0, 25).map((a) => ({
              label: a.nickname.slice(0, 100),
              description: `Rain ${a.join_rain ? "on" : "off"} · lvl ${a.level ?? "—"}`,
              value: String(a.id),
              default: a.id === focus.id,
            })),
          ),
      ),
    );
  }

  const rainOn = Number(focus.join_rain) !== 0;
  const casesOn = Number(focus.auto_open_cases) !== 0;
  const limboOn = Number(focus.limbo_wager_enabled) !== 0;
  const paused = isAccountAutomationPaused(focus);

  rows.push(
    new ActionRowBuilder<MessageActionRowComponentBuilder>().addComponents(
      new ButtonBuilder()
        .setCustomId(`${DASHBOARD_PREFIX}rain:on:${focus.id}`)
        .setLabel("Rain ON")
        .setStyle(rainOn ? ButtonStyle.Success : ButtonStyle.Secondary),
      new ButtonBuilder()
        .setCustomId(`${DASHBOARD_PREFIX}rain:off:${focus.id}`)
        .setLabel("Rain OFF")
        .setStyle(!rainOn ? ButtonStyle.Danger : ButtonStyle.Secondary),
      new ButtonBuilder()
        .setCustomId(`${DASHBOARD_PREFIX}cases:toggle:${focus.id}`)
        .setLabel(casesOn ? "Cases ON" : "Cases OFF")
        .setStyle(casesOn ? ButtonStyle.Primary : ButtonStyle.Secondary),
      new ButtonBuilder()
        .setCustomId(`${DASHBOARD_PREFIX}limbo:toggle:${focus.id}`)
        .setLabel(limboOn ? "Limbo ON" : "Limbo OFF")
        .setStyle(limboOn ? ButtonStyle.Primary : ButtonStyle.Secondary),
      new ButtonBuilder()
        .setCustomId(`${DASHBOARD_PREFIX}refresh:${focus.id}`)
        .setLabel("Refresh")
        .setStyle(ButtonStyle.Secondary),
    ),
  );

  rows.push(
    new ActionRowBuilder<MessageActionRowComponentBuilder>().addComponents(
      new ButtonBuilder()
        .setCustomId(`${DASHBOARD_PREFIX}pause:${focus.id}`)
        .setLabel(paused ? "Resume automation" : "Pause automation")
        .setStyle(paused ? ButtonStyle.Success : ButtonStyle.Secondary),
    ),
  );

  return rows;
}

export type AccountDashboardVariant = "dashboard" | "list";

export function buildAccountDashboardView(
  discordUserId: string,
  focusAccountId?: number,
  variant: AccountDashboardVariant = "dashboard",
) {
  const accounts = accountsForDiscordUser(discordUserId);
  const focusId = focusAccountId ?? accounts[0]?.id;
  const focusNick = accounts.find((a) => a.id === focusId)?.nickname ?? "account";
  let embed = buildAccountsEmbed(discordUserId);
  if (accounts.length === 0) {
    embed = embed.setDescription("No accounts yet. Use `/account add` or `/account session`.");
  } else if (variant === "dashboard") {
    embed = embed
      .setTitle("Your dashboard")
      .setDescription(
        `Controls apply to **${focusNick}** — pick another account in the menu or use the buttons below.`,
      );
  } else {
    embed = embed.setDescription(
      `Controls apply to **${focusNick}** — rain, cases, limbo, refresh, and pause/resume below.`,
    );
  }
  const components =
    focusId != null ? buildAccountDashboardComponents(discordUserId, focusId) : [];
  return { embed, components };
}

async function renderDashboard(
  interaction: MessageComponentInteraction,
  discordUserId: string,
  focusAccountId: number,
): Promise<void> {
  const { embed, components } = buildAccountDashboardView(discordUserId, focusAccountId);
  await replyEphemeralEmbeds(interaction, [embed], components);
}

export async function handleDashboardInteraction(interaction: MessageComponentInteraction): Promise<void> {
  const userId = interaction.user.id;
  const customId = interaction.customId;

  if (customId === `${DASHBOARD_PREFIX}account-select`) {
    if (!interaction.isStringSelectMenu()) return;
    const sel = interaction as StringSelectMenuInteraction;
    const accountId = parseAccountIdFromSuffix(sel.values[0] ?? "");
    if (accountId == null || !assertOwnedAccount(userId, accountId)) {
      await deferEphemeral(interaction);
      await replyEphemeralEmbeds(interaction, [
        buildPlainResultEmbed("That account is not yours.", false),
      ]);
      return;
    }
    await deferEphemeral(interaction);
    await engine.refreshAccountStatsForIds([accountId]);
    await renderDashboard(interaction, userId, accountId);
    return;
  }

  const accountId = dashboardAccountIdFromCustomId(customId);
  if (accountId == null) return;
  const account = assertOwnedAccount(userId, accountId);
  if (!account) {
    await deferEphemeral(interaction);
    await replyEphemeralEmbeds(interaction, [buildPlainResultEmbed("That account is not yours.", false)]);
    return;
  }

  await deferEphemeral(interaction);

  if (customId.startsWith(`${DASHBOARD_PREFIX}rain:on:`)) {
    await setToggle(userId, account.nickname, "join_rain", true);
  } else if (customId.startsWith(`${DASHBOARD_PREFIX}rain:off:`)) {
    await setToggle(userId, account.nickname, "join_rain", false);
  } else if (customId.startsWith(`${DASHBOARD_PREFIX}cases:toggle:`)) {
    const on = Number(account.auto_open_cases) === 0;
    await setToggle(userId, account.nickname, "auto_open_cases", on);
  } else if (customId.startsWith(`${DASHBOARD_PREFIX}limbo:toggle:`)) {
    const { setLimbo } = await import("./friends-commands.js");
    const on = Number(account.limbo_wager_enabled) === 0;
    await setLimbo(userId, account.nickname, { enabled: on });
  } else if (customId.startsWith(`${DASHBOARD_PREFIX}refresh:`)) {
    await engine.refreshAccountStatsForIds([accountId]);
  } else if (customId.startsWith(`${DASHBOARD_PREFIX}pause:`)) {
    const paused = isAccountAutomationPaused(account);
    await setAccountAutomationPaused({
      actorUserId: userId,
      isHost: false,
      nickname: account.nickname,
      paused: !paused,
    });
  }

  await engine.refreshAccountStatsForIds([accountId]);
  await renderDashboard(interaction, userId, accountId);
}
