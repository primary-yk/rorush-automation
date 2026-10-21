/**
 * One-shot: verify DISCORD_BOT_TOKEN + DISCORD_GUILD_ID (no full engine).
 * Usage: npm run discord-login-smoke
 */
import "../src/bootstrap-env.js";
import { Client, GatewayIntentBits } from "discord.js";

const token = process.env.DISCORD_BOT_TOKEN?.trim();
const guildId = process.env.DISCORD_GUILD_ID?.trim();
if (!token || !guildId) {
  console.error("Set DISCORD_BOT_TOKEN and DISCORD_GUILD_ID in .env");
  process.exit(1);
}

const client = new Client({ intents: [GatewayIntentBits.Guilds] });
client.once("ready", async () => {
  const guild = await client.guilds.fetch(guildId).catch(() => null);
  console.log(guild ? `OK — bot is in server "${guild.name}" (${guild.id})` : "FAIL — bot not in that server (re-invite with new guild URL)");
  await client.destroy();
  process.exit(guild ? 0 : 1);
});
client.login(token).catch((err) => {
  console.error("Login failed:", err instanceof Error ? err.message : String(err));
  process.exit(1);
});
