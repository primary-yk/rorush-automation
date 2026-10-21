/** IDs persisted after `/server setup` — used to repair permissions on re-run. */

export const FRIENDS_LAYOUT_VERSION = 1 as const;

export const FRIENDS_ROLE_NAMES = {
  host: "Rain Staff",
  pilot: "Rain Member",
} as const;

export const FRIENDS_CATEGORY_NAMES = {
  info: "INFO",
  feeds: "PRIVATE FEEDS",
  host: "STAFF",
} as const;

export const FRIENDS_CHANNEL_NAMES = {
  startHere: "start-here",
  commands: "commands",
  rainFeeds: "rain-feeds",
  hostLog: "host-log",
} as const;

export type FriendsServerLayout = {
  version: typeof FRIENDS_LAYOUT_VERSION;
  roleIds: { host: string; pilot: string };
  categoryIds: { info: string; feeds: string; host: string };
  channelIds: {
    startHere: string;
    commands: string;
    rainFeeds: string;
    hostLog: string;
  };
};

export function parseFriendsServerLayout(raw: string | null | undefined): FriendsServerLayout | null {
  if (!raw?.trim()) return null;
  try {
    const json = JSON.parse(raw) as FriendsServerLayout;
    if (json.version !== FRIENDS_LAYOUT_VERSION) return null;
    if (!json.roleIds?.host || !json.roleIds?.pilot) return null;
    if (!json.channelIds?.rainFeeds || !json.channelIds?.hostLog) return null;
    return json;
  } catch {
    return null;
  }
}
