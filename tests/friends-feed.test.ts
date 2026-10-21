import { describe, expect, it } from "vitest";
import { parseFriendsServerLayout } from "../src/discord/friends-layout.js";
import { classifyEmbedRoute } from "../src/discord/friends-feed.js";

describe("parseFriendsServerLayout", () => {
  it("returns null for empty or invalid json", () => {
    expect(parseFriendsServerLayout(null)).toBeNull();
    expect(parseFriendsServerLayout("{}")).toBeNull();
  });

  it("parses v1 layout", () => {
    const layout = {
      version: 1,
      roleIds: { host: "1", pilot: "2" },
      categoryIds: { info: "a", feeds: "b", host: "c" },
      channelIds: { startHere: "d", commands: "e", rainFeeds: "f", hostLog: "g" },
    };
    expect(parseFriendsServerLayout(JSON.stringify(layout))).toEqual(layout);
  });
});

describe("classifyEmbedRoute", () => {
  it("routes failures to host", () => {
    expect(classifyEmbedRoute("Rain — Failed", true)).toBe("host");
  });

  it("routes joins to user when owner exists", () => {
    expect(classifyEmbedRoute("Rain — Joined", true)).toBe("user");
  });
});
