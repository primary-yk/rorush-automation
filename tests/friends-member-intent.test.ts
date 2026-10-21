import { afterEach, describe, expect, it } from "vitest";
import {
  serverMembersIntentOptedOut,
  useServerMembersIntent,
} from "../src/discord/friends-member-intent.js";

const env = process.env;

afterEach(() => {
  process.env = { ...env };
});

describe("friends-member-intent", () => {
  it("defaults on for friends guild bot", () => {
    delete process.env.DISCORD_SERVER_MEMBERS_INTENT;
    process.env.DISCORD_GUILD_ID = "123";
    delete process.env.DISCORD_BOT_RELAY_URL;
    expect(useServerMembersIntent()).toBe(true);
    expect(serverMembersIntentOptedOut()).toBe(false);
  });

  it("respects explicit opt-out", () => {
    process.env.DISCORD_GUILD_ID = "123";
    process.env.DISCORD_SERVER_MEMBERS_INTENT = "0";
    expect(useServerMembersIntent()).toBe(false);
    expect(serverMembersIntentOptedOut()).toBe(true);
  });

  it("off when relay mode", () => {
    delete process.env.DISCORD_SERVER_MEMBERS_INTENT;
    process.env.DISCORD_GUILD_ID = "123";
    process.env.DISCORD_BOT_RELAY_URL = "ws://localhost";
    expect(useServerMembersIntent()).toBe(false);
  });
});
