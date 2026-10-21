import { ChannelType, type Guild, type NonThreadGuildBasedChannel } from "discord.js";
import {
  FRIENDS_CATEGORY_NAMES,
  FRIENDS_CHANNEL_NAMES,
  type FriendsServerLayout,
} from "./friends-layout.js";

/** Older layout category titles (re-run setup removes these too). */
export const LEGACY_CATEGORY_NAMES = [
  "RUSH PILOT · INFO",
  "RUSH PILOT · FEEDS",
  "RUSH PILOT · HOST",
] as const;

const MANAGED_CATEGORY_NAMES = new Set<string>([
  ...Object.values(FRIENDS_CATEGORY_NAMES),
  ...LEGACY_CATEGORY_NAMES,
]);

const MANAGED_CHANNEL_NAMES = new Set<string>(Object.values(FRIENDS_CHANNEL_NAMES));

export function isManagedCategoryName(name: string): boolean {
  return MANAGED_CATEGORY_NAMES.has(name);
}

export function isManagedChannelName(name: string): boolean {
  return MANAGED_CHANNEL_NAMES.has(name);
}

/** Channel ids that belong to a prior bot layout (safe to delete on re-setup). */
export function collectManagedChannelIds(
  channels: Iterable<NonThreadGuildBasedChannel | import("discord.js").ThreadChannel>,
  prior: FriendsServerLayout | null,
): string[] {
  const ids = new Set<string>();
  const list = [...channels];

  if (prior) {
    for (const id of Object.values(prior.categoryIds)) ids.add(id);
    for (const id of Object.values(prior.channelIds)) ids.add(id);
  }

  for (const ch of list) {
    if (ch.type === ChannelType.GuildCategory && isManagedCategoryName(ch.name)) {
      ids.add(ch.id);
    }
  }

  for (const ch of list) {
    if (ch.parentId && ids.has(ch.parentId)) {
      ids.add(ch.id);
    }
  }

  for (const ch of list) {
    if (ch.type === ChannelType.GuildText && isManagedChannelName(ch.name)) {
      ids.add(ch.id);
    }
  }

  if (prior?.channelIds.rainFeeds) {
    const parentId = prior.channelIds.rainFeeds;
    for (const ch of list) {
      if (ch.isThread() && ch.parentId === parentId) {
        ids.add(ch.id);
      }
    }
  }

  for (const ch of list) {
    if (ch.isThread() && ch.parentId && ids.has(ch.parentId)) {
      ids.add(ch.id);
    }
  }

  return [...ids];
}

function deleteRank(channel: NonThreadGuildBasedChannel | import("discord.js").ThreadChannel | undefined): number {
  if (!channel) return 1;
  if (channel.isThread()) return 0;
  if (channel.type === ChannelType.GuildCategory) return 2;
  return 1;
}

export async function purgeManagedServerChannels(
  guild: Guild,
  prior: FriendsServerLayout | null,
): Promise<{ deleted: number }> {
  await guild.channels.fetch();
  const ids = collectManagedChannelIds(guild.channels.cache.values(), prior);
  ids.sort((a, b) => {
    const ca = guild.channels.cache.get(a);
    const cb = guild.channels.cache.get(b);
    return deleteRank(ca) - deleteRank(cb);
  });

  let deleted = 0;
  for (const id of ids) {
    const ch = guild.channels.cache.get(id);
    if (!ch) continue;
    const ok = await ch.delete("Discord /server setup — replace layout").then(() => true).catch(() => false);
    if (ok) deleted += 1;
  }
  return { deleted };
}
