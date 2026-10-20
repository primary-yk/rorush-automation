import "./bootstrap-env.js";
import { closeDb, getDb } from "./db/database.js";
import { startApiServer } from "./api/server.js";
import { engine } from "./worker/engine.js";
import { captchaApiKey, loadConfig, projectRoot } from "./config.js";
import { listAccounts } from "./db/repositories.js";
import { activateLicense } from "./license/service.js";
import { startFriendsDiscordBot, stopFriendsDiscordBot } from "./discord/friends-bot.js";
import { startPilotRelayClient, stopPilotRelayClient } from "./relay/pilot-client.js";

process.on("uncaughtException", (err) => {
  console.error("[fatal]", err.message);
});

process.on("unhandledRejection", (err) => {
  console.error("[unhandled]", err instanceof Error ? err.message : String(err));
});

async function main() {
  getDb();
  const envLicense = process.env.RUSH_PILOT_LICENSE?.trim();
  if (envLicense) {
    try {
      activateLicense(envLicense);
      console.log("License loaded from RUSH_PILOT_LICENSE in .env");
    } catch (err) {
      console.warn("RUSH_PILOT_LICENSE invalid:", err instanceof Error ? err.message : String(err));
    }
  }
  const cfg = loadConfig();
  await startApiServer();
  console.log(`Automation API listening on http://${cfg.AUTOMATION_API_HOST}:${cfg.AUTOMATION_API_PORT}`);
  console.log(`Database: ${cfg.DATABASE_PATH} (${listAccounts().length} account(s))`);
  if (!cfg.ENCRYPTION_KEY?.trim()) {
    console.warn("WARNING: ENCRYPTION_KEY missing in .env — you cannot save RoRush accounts until it is set.");
  }
  const rainAccounts = listAccounts().filter((a) => a.join_rain);
  if (rainAccounts.length > 0 && !captchaApiKey(cfg)) {
    console.warn(
      "WARNING: CAPTCHA_API_KEY missing — rain needs hCaptcha (2Captcha/CapSolver; CapMonster no longer supports hCaptcha API).",
    );
  }
  console.log(`Project root: ${projectRoot()}`);
  if (process.env.HOSTED_SAAS?.trim()) {
    console.log("HOSTED_SAAS=1 — customers use Discord only; you run this server 24/7.");
  } else if (!process.env.DISCORD_BOT_RELAY_URL?.trim()) {
    console.log("Friends mode — Discord bot only for your group; no license keys required.");
  }
  await engine.start();
  if (process.env.DISCORD_BOT_RELAY_URL?.trim()) {
    startPilotRelayClient();
  } else {
    await startFriendsDiscordBot();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

process.on("SIGINT", async () => {
  stopPilotRelayClient();
  await stopFriendsDiscordBot();
  await engine.stop();
  closeDb();
  process.exit(0);
});

process.on("SIGTERM", async () => {
  stopPilotRelayClient();
  await stopFriendsDiscordBot();
  await engine.stop();
  closeDb();
  process.exit(0);
});
