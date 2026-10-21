import {
  type ActionRowBuilder,
  type MessageActionRowComponentBuilder,
  type MessageComponentInteraction,
} from "discord.js";
import { engine } from "../worker/engine.js";
import { accountsForDiscordUser, findOwnedAccount } from "./friends-commands.js";
import {
  buildAccountDashboardComponents,
  buildAccountDashboardView,
} from "./friends-dashboard.js";
import { deferEphemeral, replyEphemeralEmbeds } from "./friends-interaction.js";
import { buildGlobalNavRow, NAV_PREFIX, prependNavRow } from "./friends-nav.js";
import {
  buildHelpEmbed,
  buildPersonalEarningsEmbed,
  buildSetupGuideEmbed,
  buildStatusEmbed,
} from "./friends-ui.js";

export { buildGlobalNavRow, isNavComponent, prependNavRow } from "./friends-nav.js";

/** Up to 5 rows: global nav, optional account controls, then dashboard rows. */
export function buildReplyComponentRows(
  discordUserId: string,
  options?: { accountNickname?: string; includeAccountControls?: boolean },
): ActionRowBuilder<MessageActionRowComponentBuilder>[] {
  const rows: ActionRowBuilder<MessageActionRowComponentBuilder>[] = [buildGlobalNavRow()];
  const nick = options?.accountNickname?.trim();
  if (options?.includeAccountControls !== false && nick) {
    const account = findOwnedAccount(discordUserId, nick);
    if (account) {
      rows.push(...buildAccountDashboardComponents(discordUserId, account.id));
    }
  }
  return rows.slice(0, 5);
}

export async function handleNavInteraction(interaction: MessageComponentInteraction): Promise<void> {
  const action = interaction.customId.slice(NAV_PREFIX.length);
  const userId = interaction.user.id;
  await deferEphemeral(interaction);

  if (action === "dashboard") {
    const owned = accountsForDiscordUser(userId);
    if (owned.length > 0) {
      await engine.refreshAccountStatsForIds(owned.map((a) => a.id));
    }
    const { embed, components } = buildAccountDashboardView(userId);
    await replyEphemeralEmbeds(interaction, [embed], prependNavRow(components));
    return;
  }

  if (action === "earnings") {
    await replyEphemeralEmbeds(
      interaction,
      [buildPersonalEarningsEmbed(userId)],
      [buildGlobalNavRow()],
    );
    return;
  }

  if (action === "guide") {
    await replyEphemeralEmbeds(interaction, [buildSetupGuideEmbed()], [buildGlobalNavRow()]);
    return;
  }

  if (action === "help") {
    await replyEphemeralEmbeds(
      interaction,
      [buildHelpEmbed(), buildSetupGuideEmbed()],
      [buildGlobalNavRow()],
    );
    return;
  }

  if (action === "status") {
    await replyEphemeralEmbeds(interaction, [buildStatusEmbed()], [buildGlobalNavRow()]);
  }
}
