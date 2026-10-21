import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  type ButtonInteraction,
  type Client,
  type Guild,
  type TextChannel,
} from "discord.js";
import { getDiscordUserThread, listDiscordUserThreads } from "../db/repositories.js";
import { COLORS, type RushEmbed } from "./embeds.js";
import { postToHostLogChannel, postToUserFeedThread } from "./friends-feed.js";
import { buildErrorEmbed, buildHostLogToolsEmbed, buildPlainResultEmbed } from "./friends-ui.js";
import { tagHostEmbed } from "./host-log-classify.js";
import { replyEphemeralEmbed } from "./friends-interaction.js";

export const FRIENDS_HOST_TEST_RAIN_ME = "friends:host:test-rain-me";
export const FRIENDS_HOST_TEST_RAIN_ALL = "friends:host:test-rain-all";
export const FRIENDS_HOST_LIST_FEEDS = "friends:host:list-feeds";

export const FRIENDS_HOST_BUTTON_IDS = new Set([
  FRIENDS_HOST_TEST_RAIN_ME,
  FRIENDS_HOST_TEST_RAIN_ALL,
  FRIENDS_HOST_LIST_FEEDS,
]);

export function buildTestRainFeedEmbed(nickname: string): RushEmbed {
  return {
    title: "Rain — Joined (test drill)",
    description: "This is a **host test** — not a real rain. Real joins will look like this in your private feed.",
    color: COLORS.rainOk,
    fields: [
      { name: "Account", value: `**${nickname}**`, inline: true },
      { name: "Pool", value: "1,000.00 coins (sample)", inline: true },
      { name: "Rain", value: "`test-drill`", inline: true },
    ],
    footer: { text: "Host test — safe to ignore" },
  };
}

export async function seedHostLogTools(channel: TextChannel, force = false): Promise<void> {
  if (!force) {
    const recent = await channel.messages.fetch({ limit: 12 }).catch(() => null);
    const hasTools = recent?.some((m) =>
      m.components.some((row) => {
        if (!row || !("components" in row)) return false;
        return row.components.some(
          (c) => "customId" in c && FRIENDS_HOST_BUTTON_IDS.has(String(c.customId)),
        );
      }),
    );
    if (hasTools) return;
  }
  const row = new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder()
      .setCustomId(FRIENDS_HOST_TEST_RAIN_ME)
      .setLabel("Test rain → my feed")
      .setStyle(ButtonStyle.Primary),
    new ButtonBuilder()
      .setCustomId(FRIENDS_HOST_TEST_RAIN_ALL)
      .setLabel("Test rain → all feeds")
      .setStyle(ButtonStyle.Secondary),
    new ButtonBuilder()
      .setCustomId(FRIENDS_HOST_LIST_FEEDS)
      .setLabel("List open feeds")
      .setStyle(ButtonStyle.Success),
  );
  await channel.send({ embeds: [buildHostLogToolsEmbed()], components: [row] }).catch(() => undefined);
}

export async function handleHostToolButton(
  interaction: ButtonInteraction,
  _client: Client,
  guild: Guild,
  isHost: boolean,
): Promise<void> {
  if (!isHost) {
    await interaction.reply({ ephemeral: true, content: "Host only — Rain Staff role / host user." });
    return;
  }

  await interaction.deferReply({ ephemeral: true });

  if (interaction.customId === FRIENDS_HOST_LIST_FEEDS) {
    const rows = listDiscordUserThreads();
    if (rows.length === 0) {
      await replyEphemeralEmbed(
        interaction,
        buildPlainResultEmbed("No private feeds registered yet. Friends use **#connect** first.", true),
      );
      return;
    }
    const lines: string[] = ["**Open private feeds**", ""];
    for (const row of rows.slice(0, 25)) {
      let tag = row.discord_user_id;
      const member = await guild.members.fetch(row.discord_user_id).catch(() => null);
      if (member) tag = member.displayName ?? member.user.username;
      lines.push(`• <@${row.discord_user_id}> · **${tag}** → <#${row.thread_id}>`);
    }
    if (rows.length > 25) lines.push(`… and **${rows.length - 25}** more`);
    await replyEphemeralEmbed(
      interaction,
      buildPlainResultEmbed(lines.join("\n"), true),
    );
    await postToHostLogChannel([
      tagHostEmbed({
        title: "Feed list viewed",
        description: `<@${interaction.user.id}> listed **${rows.length}** private feed(s).`,
        color: 0x63_66_f1,
      }),
    ]);
    return;
  }

  const embed = buildTestRainFeedEmbed("drill");

  if (interaction.customId === FRIENDS_HOST_TEST_RAIN_ME) {
    const row = getDiscordUserThread(interaction.user.id);
    if (!row?.thread_id) {
      await replyEphemeralEmbed(
        interaction,
        buildErrorEmbed("You have no private feed yet — run **`/connect`** first, then test again."),
      );
      return;
    }
    const ok = await postToUserFeedThread(interaction.user.id, [embed]);
    if (!ok) {
      await replyEphemeralEmbed(
        interaction,
        buildErrorEmbed("Could not post to your thread — run **`/connect`** again."),
      );
      return;
    }
    await replyEphemeralEmbed(
      interaction,
      buildPlainResultEmbed(`Test rain alert sent to <#${row.thread_id}>.`, true),
    );
    await postToHostLogChannel([
      tagHostEmbed({
        title: "Rain drill (host)",
        description: `<@${interaction.user.id}> sent a test rain embed to their feed <#${row.thread_id}>.`,
        color: COLORS.rainOk,
      }),
    ]);
    return;
  }

  if (interaction.customId === FRIENDS_HOST_TEST_RAIN_ALL) {
    const rows = listDiscordUserThreads();
    if (rows.length === 0) {
      await replyEphemeralEmbed(
        interaction,
        buildErrorEmbed("No feeds to test — nobody has run **`/connect`** yet."),
      );
      return;
    }
    let okCount = 0;
    for (const row of rows) {
      const ok = await postToUserFeedThread(row.discord_user_id, [embed]);
      if (ok) okCount += 1;
    }
    await replyEphemeralEmbed(
      interaction,
      buildPlainResultEmbed(
        `Test rain sent to **${okCount}** / **${rows.length}** private feed(s). Check threads under **#rain-feeds**.`,
        okCount > 0,
      ),
    );
    await postToHostLogChannel([
      tagHostEmbed({
        title: "Rain drill (all feeds)",
        description: `<@${interaction.user.id}> blasted a test rain embed to **${okCount}** feed(s).`,
        color: COLORS.rainOk,
      }),
    ]);
  }
}
