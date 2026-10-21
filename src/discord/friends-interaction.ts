import type {
  ActionRowBuilder,
  ChatInputCommandInteraction,
  EmbedBuilder,
  MessageActionRowComponentBuilder,
  MessageComponentInteraction,
} from "discord.js";

type EphemeralInteraction = ChatInputCommandInteraction | MessageComponentInteraction;

export function isInteractionAlreadyAcknowledged(err: unknown): boolean {
  const msg = err instanceof Error ? err.message : String(err);
  const code = (err as { code?: number })?.code;
  return code === 40060 || /already been acknowledged|interaction has/i.test(msg);
}

/** Defer ephemeral once; returns false if another process already handled this interaction. */
export async function deferEphemeral(interaction: EphemeralInteraction): Promise<boolean> {
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
  interaction: EphemeralInteraction,
  embeds: EmbedBuilder[],
  components?: ActionRowBuilder<MessageActionRowComponentBuilder>[],
): Promise<void> {
  const slice = embeds.slice(0, 10);
  const rows = components?.slice(0, 5);
  const payload = {
    content: "",
    embeds: slice,
    components: rows?.length ? rows : [],
  };
  if (interaction.deferred || interaction.replied) {
    await interaction.editReply(payload).catch((err) => {
      if (!isInteractionAlreadyAcknowledged(err)) throw err;
    });
    return;
  }
  await interaction.reply({ ephemeral: true, ...payload }).catch((err) => {
    if (!isInteractionAlreadyAcknowledged(err)) throw err;
  });
}

export async function replyEphemeralEmbed(
  interaction: EphemeralInteraction,
  embed: EmbedBuilder,
): Promise<void> {
  await replyEphemeralEmbeds(interaction, [embed]);
}
