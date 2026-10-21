import { ChannelType } from "discord.js";
import { describe, expect, it } from "vitest";
import {
  collectManagedChannelIds,
  isManagedCategoryName,
  isManagedChannelName,
} from "../src/discord/friends-server-purge.js";
import { FRIENDS_LAYOUT_VERSION } from "../src/discord/friends-layout.js";

describe("friends-server-purge", () => {
  it("recognizes managed names", () => {
    expect(isManagedCategoryName("INFO")).toBe(true);
    expect(isManagedCategoryName("RUSH PILOT · FEEDS")).toBe(true);
    expect(isManagedCategoryName("general")).toBe(false);
    expect(isManagedChannelName("rain-feeds")).toBe(true);
    expect(isManagedChannelName("random")).toBe(false);
  });

  it("collects prior layout ids and children", () => {
    const prior = {
      version: FRIENDS_LAYOUT_VERSION,
      roleIds: { host: "r1", pilot: "r2" },
      categoryIds: { info: "cat-info", feeds: "cat-feeds", host: "cat-host" },
      channelIds: {
        startHere: "ch-start",
        commands: "ch-cmd",
        rainFeeds: "ch-rain",
        hostLog: "ch-log",
      },
    };
    const channels = [
      { id: "cat-info", type: ChannelType.GuildCategory, name: "INFO", parentId: null, isThread: () => false },
      { id: "ch-start", type: ChannelType.GuildText, name: "start-here", parentId: "cat-info", isThread: () => false },
      { id: "ch-rain", type: ChannelType.GuildText, name: "rain-feeds", parentId: "cat-feeds", isThread: () => false },
      { id: "th-1", type: ChannelType.PrivateThread, name: "pilot-x", parentId: "ch-rain", isThread: () => true },
      { id: "ch-other", type: ChannelType.GuildText, name: "memes", parentId: null, isThread: () => false },
    ] as const;

    const ids = collectManagedChannelIds(channels, prior);
    expect(ids).toContain("cat-info");
    expect(ids).toContain("ch-start");
    expect(ids).toContain("ch-rain");
    expect(ids).toContain("th-1");
    expect(ids).not.toContain("ch-other");
  });
});
