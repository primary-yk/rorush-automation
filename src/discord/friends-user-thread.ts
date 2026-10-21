import { ChannelType, type Client, type Guild, type TextChannel } from "discord.js";
import { getSettings, upsertDiscordUserThread } from "../db/repositories.js";
import { buildThreadWelcomeEmbed } from "./friends-ui.js";
import { addGuildMemberRole } from "./friends-guild-roles.js";
import { FRIENDS_ROLE_NAMES, parseFriendsServerLayout } from "./friends-layout.js";

export async function assignPilotRole(input: {
  token: string;
  guildId: string;
  userId: string;
  pilotRoleId: string;
}): Promise<void> {
  await addGuildMemberRole({
    token: input.token,
    guildId: input.guildId,
    userId: input.userId,
    roleId: input.pilotRoleId,
  });
}

export async function ensureUserPrivateFeedThread(input: {
  client: Client;
  guild: Guild;
  discordUserId: string;
  username: string;
}): Promise<{ threadId: string; created: boolean }> {
  const settings = getSettings();
  const parentId = settings.discord_thread_parent_id?.trim();
  if (!parentId) {
    throw new Error("Server not configured yet. Ask the host to run **`/setup server`** first.");
  }

  const { getDiscordUserThread } = await import("../db/repositories.js");
  const row = getDiscordUserThread(input.discordUserId);
  if (row?.thread_id) {
    const ch = await input.client.channels.fetch(row.thread_id).catch(() => null);
    if (ch?.isTextBased()) {
      await input.client.channels.fetch(row.thread_id);
      return { threadId: row.thread_id, created: false };
    }
  }

  const parent = (await input.guild.channels.fetch(parentId)) as TextChannel | null;
  if (!parent?.isTextBased() || parent.type !== ChannelType.GuildText) {
    throw new Error("Feed hub channel missing — host should run **`/setup server`** again.");
  }

  const thread = await parent.threads.create({
    name: `pilot-${input.username}`.slice(0, 100),
    type: ChannelType.PrivateThread,
    invitable: false,
    reason: "Friend private feed",
  });
  await thread.members.add(input.discordUserId).catch(() => undefined);

  const layout = parseFriendsServerLayout(settings.discord_server_layout_json);
  const hostId = process.env.HOST_DISCORD_USER_ID?.trim();
  if (hostId && hostId !== input.discordUserId) {
    await thread.members.add(hostId).catch(() => undefined);
  }

  upsertDiscordUserThread({ discordUserId: input.discordUserId, threadId: thread.id });

  await thread.send({ embeds: [buildThreadWelcomeEmbed()] }).catch(() => undefined);

  return { threadId: thread.id, created: true };
}

export async function runSetupJoin(input: {
  client: Client;
  guild: Guild;
  token: string;
  discordUserId: string;
  username: string;
}): Promise<{ threadId: string; created: boolean }> {
  const layout = parseFriendsServerLayout(getSettings().discord_server_layout_json);
  if (layout?.roleIds.pilot) {
    await assignPilotRole({
      token: input.token,
      guildId: input.guild.id,
      userId: input.discordUserId,
      pilotRoleId: layout.roleIds.pilot,
    }).catch(() => undefined);
  }
  /* Rain Member also applied here via REST — no Server Members Intent required */

  return ensureUserPrivateFeedThread(input);
}

/** @internal */
export function pilotRoleNameForDocs(): string {
  return FRIENDS_ROLE_NAMES.pilot;
}
