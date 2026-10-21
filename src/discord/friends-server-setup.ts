import {
  ChannelType,
  PermissionFlagsBits,
  REST,
  Routes,
  type CategoryChannel,
  type Guild,
  type Role,
  type TextChannel,
} from "discord.js";
import { getSettings, updateSettings } from "../db/repositories.js";
import {
  FRIENDS_CATEGORY_NAMES,
  FRIENDS_CHANNEL_NAMES,
  FRIENDS_LAYOUT_VERSION,
  FRIENDS_ROLE_NAMES,
  type FriendsServerLayout,
  parseFriendsServerLayout,
} from "./friends-layout.js";
import { friendCommandsChannelText, friendStartHereChannelText } from "./friends-copy.js";
import { SETUP_SERVER_BOT_PERMISSIONS } from "./friends-feed.js";

const HOST_COLOR = 0x8b_5c_f6;
const PILOT_COLOR = 0x06_b6_d4;

export type ServerSetupResult = {
  layout: FriendsServerLayout;
  summaryLines: string[];
};

function botAllow(): bigint {
  return (
    PermissionFlagsBits.ViewChannel |
    PermissionFlagsBits.SendMessages |
    PermissionFlagsBits.EmbedLinks |
    PermissionFlagsBits.ManageThreads |
    PermissionFlagsBits.CreatePrivateThreads |
    PermissionFlagsBits.SendMessagesInThreads |
    PermissionFlagsBits.ReadMessageHistory |
    PermissionFlagsBits.ManageRoles |
    PermissionFlagsBits.ManageChannels
  );
}

async function findRole(guild: Guild, id: string | undefined, name: string): Promise<Role | null> {
  if (id) {
    const r = await guild.roles.fetch(id).catch(() => null);
    if (r) return r;
  }
  return guild.roles.cache.find((r) => r.name === name) ?? null;
}

async function findCategory(
  guild: Guild,
  id: string | undefined,
  name: string,
): Promise<CategoryChannel | null> {
  if (id) {
    const ch = await guild.channels.fetch(id).catch(() => null);
    if (ch?.type === ChannelType.GuildCategory) return ch;
  }
  const hit = guild.channels.cache.find(
    (c) => c.type === ChannelType.GuildCategory && c.name === name,
  );
  return hit?.type === ChannelType.GuildCategory ? hit : null;
}

async function findTextChannel(
  guild: Guild,
  id: string | undefined,
  name: string,
  parentId?: string,
): Promise<TextChannel | null> {
  if (id) {
    const ch = await guild.channels.fetch(id).catch(() => null);
    if (ch?.isTextBased() && ch.type === ChannelType.GuildText) return ch as TextChannel;
  }
  const hit = guild.channels.cache.find(
    (c) =>
      c.type === ChannelType.GuildText &&
      c.name === name &&
      (!parentId || c.parentId === parentId),
  );
  return hit?.type === ChannelType.GuildText ? (hit as TextChannel) : null;
}

async function ensureRole(guild: Guild, name: string, color: number, existingId?: string): Promise<Role> {
  const found = await findRole(guild, existingId, name);
  if (found) {
    await found
      .edit({ name, color, mentionable: false, reason: "Discord /setup server" })
      .catch(() => undefined);
    return found;
  }
  return guild.roles.create({
    name,
    color,
    mentionable: false,
    reason: "Discord /setup server",
  });
}

async function ensureCategory(
  guild: Guild,
  name: string,
  existingId?: string,
): Promise<CategoryChannel> {
  const found = await findCategory(guild, existingId, name);
  if (found) {
    if (found.name !== name) {
      await found.setName(name, "Discord /setup server").catch(() => undefined);
    }
    return found;
  }
  return guild.channels.create({
    name,
    type: ChannelType.GuildCategory,
    reason: "Discord /setup server",
  });
}

async function applyCategoryPerms(
  category: CategoryChannel,
  everyoneId: string,
  hostRoleId: string,
  pilotRoleId: string,
  botId: string,
  mode: "info" | "feeds" | "host",
): Promise<void> {
  const bot = botAllow();
  const overwrites: Array<{
    id: string;
    deny?: bigint[];
    allow?: bigint[];
  }> = [{ id: everyoneId, deny: [PermissionFlagsBits.ViewChannel] }];

  if (mode === "host") {
    overwrites.push(
      { id: hostRoleId, allow: [bot, PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages] },
      { id: botId, allow: [bot] },
    );
  } else if (mode === "feeds") {
    overwrites.push(
      {
        id: pilotRoleId,
        allow: [
          PermissionFlagsBits.ViewChannel,
          PermissionFlagsBits.CreatePrivateThreads,
          PermissionFlagsBits.SendMessagesInThreads,
          PermissionFlagsBits.ReadMessageHistory,
        ],
      },
      {
        id: hostRoleId,
        allow: [
          PermissionFlagsBits.ViewChannel,
          PermissionFlagsBits.ManageThreads,
          PermissionFlagsBits.SendMessages,
          PermissionFlagsBits.CreatePrivateThreads,
        ],
      },
      { id: botId, allow: [bot] },
    );
  } else {
    overwrites.push(
      {
        id: pilotRoleId,
        allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.ReadMessageHistory],
      },
      {
        id: hostRoleId,
        allow: [
          PermissionFlagsBits.ViewChannel,
          PermissionFlagsBits.SendMessages,
          PermissionFlagsBits.ManageMessages,
        ],
      },
      { id: botId, allow: [bot] },
    );
  }

  await category.permissionOverwrites.set(overwrites, "Discord /setup server");
}

async function ensureTextChannel(input: {
  guild: Guild;
  name: string;
  parent: CategoryChannel;
  existingId?: string;
  everyoneId: string;
  hostRoleId: string;
  pilotRoleId: string;
  botId: string;
  mode: "info-readonly" | "feeds-hub" | "host-log";
}): Promise<TextChannel> {
  let ch = await findTextChannel(input.guild, input.existingId, input.name, input.parent.id);
  if (!ch) {
    ch = await input.guild.channels.create({
      name: input.name,
      type: ChannelType.GuildText,
      parent: input.parent.id,
      reason: "Discord /setup server",
    });
  } else if (ch.parentId !== input.parent.id) {
    await ch.setParent(input.parent.id, { reason: "Discord /setup server" }).catch(() => undefined);
  }

  const bot = botAllow();
  const overwrites: Array<{ id: string; deny?: bigint[]; allow?: bigint[] }> = [
    { id: input.everyoneId, deny: [PermissionFlagsBits.ViewChannel] },
  ];

  if (input.mode === "host-log") {
    overwrites.push(
      {
        id: input.hostRoleId,
        allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages, PermissionFlagsBits.ReadMessageHistory],
      },
      { id: input.botId, allow: [bot] },
    );
  } else if (input.mode === "feeds-hub") {
    overwrites.push(
      {
        id: input.pilotRoleId,
        allow: [
          PermissionFlagsBits.ViewChannel,
          PermissionFlagsBits.CreatePrivateThreads,
          PermissionFlagsBits.SendMessagesInThreads,
          PermissionFlagsBits.ReadMessageHistory,
        ],
      },
      {
        id: input.hostRoleId,
        allow: [
          PermissionFlagsBits.ViewChannel,
          PermissionFlagsBits.ManageThreads,
          PermissionFlagsBits.SendMessages,
          PermissionFlagsBits.CreatePrivateThreads,
        ],
      },
      { id: input.botId, allow: [bot] },
    );
  } else {
    overwrites.push(
      {
        id: input.pilotRoleId,
        allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.ReadMessageHistory],
      },
      {
        id: input.hostRoleId,
        allow: [
          PermissionFlagsBits.ViewChannel,
          PermissionFlagsBits.SendMessages,
          PermissionFlagsBits.ManageMessages,
        ],
      },
      { id: input.botId, allow: [bot] },
    );
  }

  await ch.permissionOverwrites.set(overwrites, "Discord /setup server");
  return ch;
}

async function assignRoleRest(token: string, guildId: string, userId: string, roleId: string): Promise<void> {
  const rest = new REST({ version: "10" }).setToken(token);
  await rest.put(Routes.guildMemberRole(guildId, userId, roleId));
}

async function seedChannelIntro(channel: TextChannel, content: string): Promise<void> {
  const recent = await channel.messages.fetch({ limit: 5 }).catch(() => null);
  if (recent && recent.size > 0) return;
  await channel.send({ content: content.slice(0, 2000) }).catch(() => undefined);
}

export async function runFriendsServerSetup(input: {
  guild: Guild;
  botUserId: string;
  hostUserId: string;
  botToken: string;
}): Promise<ServerSetupResult> {
  const me = await input.guild.members.fetchMe();
  if (!me.permissions.has(SETUP_SERVER_BOT_PERMISSIONS)) {
    throw new Error(
      "Bot needs **Manage Roles**, **Manage Channels**, and **Manage Threads** on this server. Re-invite with those permissions.",
    );
  }

  const prior = parseFriendsServerLayout(getSettings().discord_server_layout_json);

  const hostRole = await ensureRole(
    input.guild,
    FRIENDS_ROLE_NAMES.host,
    HOST_COLOR,
    prior?.roleIds.host,
  );
  const pilotRole = await ensureRole(
    input.guild,
    FRIENDS_ROLE_NAMES.pilot,
    PILOT_COLOR,
    prior?.roleIds.pilot,
  );

  const infoCat = await ensureCategory(input.guild, FRIENDS_CATEGORY_NAMES.info, prior?.categoryIds.info);
  const feedsCat = await ensureCategory(input.guild, FRIENDS_CATEGORY_NAMES.feeds, prior?.categoryIds.feeds);
  const hostCat = await ensureCategory(input.guild, FRIENDS_CATEGORY_NAMES.host, prior?.categoryIds.host);

  const everyoneId = input.guild.roles.everyone.id;

  await applyCategoryPerms(infoCat, everyoneId, hostRole.id, pilotRole.id, input.botUserId, "info");
  await applyCategoryPerms(feedsCat, everyoneId, hostRole.id, pilotRole.id, input.botUserId, "feeds");
  await applyCategoryPerms(hostCat, everyoneId, hostRole.id, pilotRole.id, input.botUserId, "host");

  const common = {
    guild: input.guild,
    everyoneId,
    hostRoleId: hostRole.id,
    pilotRoleId: pilotRole.id,
    botId: input.botUserId,
  };

  const startHere = await ensureTextChannel({
    ...common,
    name: FRIENDS_CHANNEL_NAMES.startHere,
    parent: infoCat,
    existingId: prior?.channelIds.startHere,
    mode: "info-readonly",
  });
  const commands = await ensureTextChannel({
    ...common,
    name: FRIENDS_CHANNEL_NAMES.commands,
    parent: infoCat,
    existingId: prior?.channelIds.commands,
    mode: "info-readonly",
  });
  const rainFeeds = await ensureTextChannel({
    ...common,
    name: FRIENDS_CHANNEL_NAMES.rainFeeds,
    parent: feedsCat,
    existingId: prior?.channelIds.rainFeeds,
    mode: "feeds-hub",
  });
  const hostLog = await ensureTextChannel({
    ...common,
    name: FRIENDS_CHANNEL_NAMES.hostLog,
    parent: hostCat,
    existingId: prior?.channelIds.hostLog,
    mode: "host-log",
  });

  await assignRoleRest(input.botToken, input.guild.id, input.hostUserId, hostRole.id).catch(() => undefined);

  await seedChannelIntro(startHere, friendStartHereChannelText());
  await seedChannelIntro(commands, friendCommandsChannelText());

  const layout: FriendsServerLayout = {
    version: FRIENDS_LAYOUT_VERSION,
    roleIds: { host: hostRole.id, pilot: pilotRole.id },
    categoryIds: { info: infoCat.id, feeds: feedsCat.id, host: hostCat.id },
    channelIds: {
      startHere: startHere.id,
      commands: commands.id,
      rainFeeds: rainFeeds.id,
      hostLog: hostLog.id,
    },
  };

  updateSettings({
    discord_thread_parent_id: rainFeeds.id,
    discord_host_log_channel_id: hostLog.id,
    discord_server_layout_json: JSON.stringify(layout),
    discord_report_enabled: 1,
  });

  const summaryLines = [
    "**Server layout applied** (safe to re-run — repairs roles & permissions)",
    "",
    `Roles · **${FRIENDS_ROLE_NAMES.host}** · **${FRIENDS_ROLE_NAMES.pilot}**`,
    `Info · ${infoCat.name} → <#${startHere.id}> · <#${commands.id}>`,
    `Feeds · ${feedsCat.name} → <#${rainFeeds.id}> (private threads per friend)`,
    `Host · ${hostCat.name} → <#${hostLog.id}> (captcha / join errors — not DMs)`,
    "",
    "Tell friends: **`/setup join`** then **`/account add`**. Staff alerts → `#host-log` (not DMs unless `DISCORD_HOST_DM_ALERTS=1`).",
  ];

  return { layout, summaryLines };
}
