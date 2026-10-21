import type { ChatInputCommandInteraction, EmbedBuilder } from "discord.js";

export function isInteractionAlreadyAcknowledged(err: unknown): boolean {
  const msg = err instanceof Error ? err.message : String(err);
  const code = (err as { code?: number })?.code;
  return code === 40060 || /already been acknowledged|interaction has/i.test(msg);
}

/** Defer ephemeral once; returns false if another process already handled this interaction. */
export async function deferEphemeral(interaction: ChatInputCommandInteraction): Promise<boolean> {
  if (interaction.deferred || interaction.replied) return true;
  try {
    await interaction.deferReply({ ephemeral: true });
    return true;
  } catch (err) {
    if (isInteractionAlreadyAcknowledged(err)) return false;
    throw err;
  }
}

export async function replyEphemeralEmbeds(
  interaction: ChatInputCommandInteraction,
  embeds: EmbedBuilder[],
): Promise<void> {
  const slice = embeds.slice(0, 10);
  if (interaction.deferred || interaction.replied) {
    await interaction.editReply({ content: "", embeds: slice }).catch((err) => {
      if (!isInteractionAlreadyAcknowledged(err)) throw err;
    });
    return;
  }
  await interaction.reply({ ephemeral: true, embeds: slice }).catch((err) => {
    if (!isInteractionAlreadyAcknowledged(err)) throw err;
  });
}

export async function replyEphemeralEmbed(
  interaction: ChatInputCommandInteraction,
  embed: EmbedBuilder,
): Promise<void> {
  await replyEphemeralEmbeds(interaction, [embed]);
}
