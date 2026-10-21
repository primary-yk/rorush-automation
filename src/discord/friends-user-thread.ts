import {
  ChannelType,
  type Client,
  type Guild,
  type PrivateThreadChannel,
  type TextChannel,
} from "discord.js";
import { getDiscordUserThread, getSettings, upsertDiscordUserThread } from "../db/repositories.js";
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

/** Legacy opt-in: host auto-added to every new private feed thread. Default off. */
export function hostAutoJoinPrivateThreads(): boolean {
  const v = process.env.DISCORD_HOST_AUTO_JOIN_FEED_THREADS?.trim().toLowerCase();
  return v === "1" || v === "true" || v === "yes" || v === "on";
}

async function ensurePrivateThreadMember(thread: PrivateThreadChannel, userId: string): Promise<void> {
  const inGuild = await thread.guild.members.fetch(userId).catch(() => null);
  if (!inGuild) return;
  await thread.members.add(userId).catch(() => undefined);
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
    throw new Error("Server not configured yet. Staff must run **`/server setup`** first.");
  }

  const row = getDiscordUserThread(input.discordUserId);
  if (row?.thread_id) {
    const ch = await input.client.channels.fetch(row.thread_id).catch(() => null);
    if (ch?.isThread()) {
      await ensurePrivateThreadMember(ch, input.discordUserId);
      return { threadId: ch.id, created: false };
    }
  }

  const parent = (await input.guild.channels.fetch(parentId)) as TextChannel | null;
  if (!parent?.isTextBased() || parent.type !== ChannelType.GuildText) {
    throw new Error("Feed hub channel missing — staff should run **`/server setup`** again.");
  }

  const thread = await parent.threads.create({
    name: `pilot-${input.username}`.slice(0, 100),
    type: ChannelType.PrivateThread,
    invitable: false,
    reason: "Friend private feed",
  });
  await ensurePrivateThreadMember(thread, input.discordUserId);

  const hostId = process.env.HOST_DISCORD_USER_ID?.trim();
  if (hostAutoJoinPrivateThreads() && hostId && hostId !== input.discordUserId) {
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

  return ensureUserPrivateFeedThread(input);
}

/** Staff joins a member's existing private feed (not added by default on create). */
export async function hostJumpToUserFeedThread(input: {
  client: Client;
  guild: Guild;
  hostUserId: string;
  targetUserId: string;
}): Promise<{ threadId: string; targetTag: string }> {
  const row = getDiscordUserThread(input.targetUserId);
  if (!row?.thread_id) {
    throw new Error("That member has no feed thread yet — ask them to run **`/connect`** first.");
  }
  const ch = await input.client.channels.fetch(row.thread_id).catch(() => null);
  if (!ch?.isThread()) {
    throw new Error("Their feed thread is missing — have them run **`/connect`**, or staff **`/thread restore`**.");
  }
  await ch.members.add(input.hostUserId).catch(() => undefined);
  const member = await input.guild.members.fetch(input.targetUserId).catch(() => null);
  const targetTag = member?.displayName ?? member?.user.username ?? "member";
  return { threadId: ch.id, targetTag };
}

/** Re-add a member to their private feed (left thread or rejoined server). */
export async function restoreUserFeedThread(input: {
  client: Client;
  guild: Guild;
  token: string;
  targetUserId: string;
  username: string;
}): Promise<{ threadId: string; created: boolean; roleRefreshed: boolean }> {
  const layout = parseFriendsServerLayout(getSettings().discord_server_layout_json);
  let roleRefreshed = false;
  if (layout?.roleIds.pilot) {
    await assignPilotRole({
      token: input.token,
      guildId: input.guild.id,
      userId: input.targetUserId,
      pilotRoleId: layout.roleIds.pilot,
    }).catch(() => undefined);
    roleRefreshed = true;
  }
  const result = await ensureUserPrivateFeedThread({
    client: input.client,
    guild: input.guild,
    discordUserId: input.targetUserId,
    username: input.username,
  });
  return { ...result, roleRefreshed };
}

/** @internal */
export function pilotRoleNameForDocs(): string {
  return FRIENDS_ROLE_NAMES.pilot;
}
