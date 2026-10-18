import dotenv from "dotenv";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { startDiscordBot, postEventToThread } from "./discord-app.js";
import { startPilotRelayServer } from "./ws-server.js";

dotenv.config({ path: path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", ".env") });

const token = process.env.DISCORD_BOT_TOKEN?.trim();
const guildId = process.env.DISCORD_GUILD_ID?.trim();
const parentChannelId = process.env.DISCORD_THREAD_PARENT_CHANNEL_ID?.trim();
const relayPort = Number(process.env.DISCORD_BOT_RELAY_PORT ?? "43125");

if (!token || !guildId || !parentChannelId) {
  console.error(
    "Set DISCORD_BOT_TOKEN, DISCORD_GUILD_ID, DISCORD_THREAD_PARENT_CHANNEL_ID in .env (vendor bot host).",
  );
  process.exit(1);
}

async function main() {
  let discordClient: Awaited<ReturnType<typeof startDiscordBot>> | null = null;

  startPilotRelayServer(relayPort, (licenseId, event) => {
    if (discordClient) {
      void postEventToThread(discordClient, licenseId, event).catch((err) => {
        console.warn("[thread post]", err instanceof Error ? err.message : String(err));
      });
    }
  });

  discordClient = await startDiscordBot({
    token,
    guildId,
    parentChannelId,
  });
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
