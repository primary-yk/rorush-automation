import { ActionRowBuilder, ButtonBuilder, ButtonStyle, type ButtonInteraction } from "discord.js";
import { getAccount } from "../db/repositories.js";
import { removeAccountForDiscordUser } from "./friends-commands.js";
import { buildPlainResultEmbed } from "./friends-ui.js";
import { replyEphemeralEmbed } from "./friends-interaction.js";

export const FRIENDS_REMOVE_CONFIRM_PREFIX = "friends:remove:yes:";
export const FRIENDS_REMOVE_CANCEL_PREFIX = "friends:remove:no:";

export function isRemoveConfirmButton(id: string): boolean {
  return id.startsWith(FRIENDS_REMOVE_CONFIRM_PREFIX) || id.startsWith(FRIENDS_REMOVE_CANCEL_PREFIX);
}

export function buildRemoveAccountConfirmRow(accountId: number): ActionRowBuilder<ButtonBuilder> {
  return new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder()
      .setCustomId(`${FRIENDS_REMOVE_CONFIRM_PREFIX}${accountId}`)
      .setLabel("Yes, remove account")
      .setStyle(ButtonStyle.Danger),
    new ButtonBuilder()
      .setCustomId(`${FRIENDS_REMOVE_CANCEL_PREFIX}${accountId}`)
      .setLabel("Cancel")
      .setStyle(ButtonStyle.Secondary),
  );
}

export async function handleRemoveAccountButton(
  interaction: ButtonInteraction,
  discordUserId: string,
): Promise<void> {
  const id = interaction.customId;
  const accountId = Number(id.split(":").pop());
  if (!Number.isFinite(accountId)) {
    await interaction.reply({ ephemeral: true, content: "Invalid button." });
    return;
  }
  const account = getAccount(accountId);
  if (!account || account.owner_discord_id !== discordUserId) {
    await interaction.reply({ ephemeral: true, content: "That account is not yours." });
    return;
  }

  if (id.startsWith(FRIENDS_REMOVE_CANCEL_PREFIX)) {
    await interaction.update({
      embeds: [buildPlainResultEmbed(`**${account.nickname}** was not removed.`, true)],
      components: [],
    });
    return;
  }

  await interaction.deferUpdate();
  const text = await removeAccountForDiscordUser(discordUserId, account.nickname);
  if (/^removed/i.test(text)) {
    const { logHostMemberActivity } = await import("./friends-host-activity.js");
    void logHostMemberActivity({
      kind: "account_remove",
      discordUserId,
      displayName: interaction.user.username,
      detail: `Nickname **${account.nickname}**`,
    });
  }
  await interaction.editReply({
    embeds: [buildPlainResultEmbed(text, /^removed/i.test(text))],
    components: [],
  });
}
