import { afterEach, describe, expect, it } from "vitest";
import { autoConnectFeedOnJoin } from "../src/discord/friends-auto-connect.js";

const env = process.env;

afterEach(() => {
  process.env = { ...env };
});

describe("friends-auto-connect", () => {
  it("defaults off for friends guild bot", () => {
    delete process.env.DISCORD_AUTO_CONNECT_ON_JOIN;
    process.env.DISCORD_GUILD_ID = "123";
    delete process.env.DISCORD_BOT_RELAY_URL;
    expect(autoConnectFeedOnJoin()).toBe(false);
  });

  it("respects explicit opt-in", () => {
    process.env.DISCORD_GUILD_ID = "123";
    process.env.DISCORD_AUTO_CONNECT_ON_JOIN = "1";
    expect(autoConnectFeedOnJoin()).toBe(true);
  });

  it("respects explicit opt-out", () => {
    process.env.DISCORD_GUILD_ID = "123";
    process.env.DISCORD_AUTO_CONNECT_ON_JOIN = "0";
    expect(autoConnectFeedOnJoin()).toBe(false);
  });

  it("off when not friends guild mode", () => {
    delete process.env.DISCORD_AUTO_CONNECT_ON_JOIN;
    delete process.env.DISCORD_GUILD_ID;
    expect(autoConnectFeedOnJoin()).toBe(false);
  });
});
