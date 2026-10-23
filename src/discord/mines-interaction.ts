import type { ButtonInteraction } from "discord.js";
import { getManualMinesSession } from "../automation/mines-manual-session.js";
import { getAccount } from "../db/repositories.js";
import { parseMinesTileCustomId, updateMinesBoardMessage } from "./mines-board.js";

export async function handleMinesTileButton(interaction: ButtonInteraction): Promise<boolean> {
  const parsed = parseMinesTileCustomId(interaction.customId);
  if (!parsed) return false;

  const account = getAccount(parsed.accountId);
  if (!account || account.owner_discord_id !== interaction.user.id) {
    await interaction.reply({ content: "That board is not for your account.", ephemeral: true });
    return true;
  }

  const session = getManualMinesSession(parsed.accountId);
  if (!session || session.closed) {
    await interaction.reply({ content: "No active mines round for this account.", ephemeral: true });
    return true;
  }

  if (session.revealed.has(parsed.tile)) {
    await interaction.deferUpdate();
    return true;
  }

  await interaction.deferUpdate();
  session.pushTile(parsed.tile);

  const status =
    `**Mines · ${account.nickname}** · revealing tile **${parsed.tile + 1}**… · target **${session.config.targetMultiplier.toFixed(2)}×**`;

  if (interaction.message.channelId && interaction.message.id) {
    await updateMinesBoardMessage({
      channelId: interaction.message.channelId,
      messageId: interaction.message.id,
      accountId: parsed.accountId,
      revealed: session.revealed,
      statusLine: status,
    });
  }

  return true;
}
