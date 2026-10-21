import { afterEach, describe, expect, it } from "vitest";
import { preferFriendsBotFeedsOverWebhook } from "../src/discord/friends-reporting.js";
import { resolveDiscordReportWebhookUrl } from "../src/discord/report-webhook.js";

const env = process.env;

afterEach(() => {
  process.env = { ...env };
});

describe("friends-reporting", () => {
  it("disables webhook when guild friends bot is configured", () => {
    process.env.DISCORD_GUILD_ID = "123";
    process.env.DISCORD_BOT_TOKEN = "token";
    delete process.env.DISCORD_BOT_RELAY_URL;
    delete process.env.HOSTED_SAAS;
    process.env.DISCORD_REPORT_WEBHOOK = "https://discord.com/api/webhooks/1/abc";
    delete process.env.DISCORD_USE_REPORT_WEBHOOK;
    expect(preferFriendsBotFeedsOverWebhook()).toBe(true);
    expect(resolveDiscordReportWebhookUrl()).toBeNull();
  });

  it("allows webhook when legacy flag set", () => {
    process.env.DISCORD_GUILD_ID = "123";
    process.env.DISCORD_BOT_TOKEN = "token";
    process.env.DISCORD_REPORT_WEBHOOK = "https://discord.com/api/webhooks/1/abc";
    process.env.DISCORD_USE_REPORT_WEBHOOK = "1";
    expect(resolveDiscordReportWebhookUrl()).toBe(process.env.DISCORD_REPORT_WEBHOOK);
  });
});
