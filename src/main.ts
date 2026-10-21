import "./bootstrap-env.js";
import { closeDb, getDb } from "./db/database.js";
import { startApiServer } from "./api/server.js";
import { engine } from "./worker/engine.js";
import { captchaApiKey, encryptionKeyStatus, loadConfig, projectRoot, reloadEnv } from "./config.js";
import { listAccounts } from "./db/repositories.js";
import { activateLicense } from "./license/service.js";
import { applyDiscordWebhookFromEnv } from "./discord/report-webhook.js";
import { startFriendsDiscordBot, stopFriendsDiscordBot } from "./discord/friends-bot.js";
import { startPilotRelayClient, stopPilotRelayClient } from "./relay/pilot-client.js";

process.on("uncaughtException", (err) => {
  console.error("[fatal]", err.message);
});

process.on("unhandledRejection", (err) => {
  console.error("[unhandled]", err instanceof Error ? err.message : String(err));
});

async function main() {
  reloadEnv();
  getDb();
  applyDiscordWebhookFromEnv();
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
  const accounts = listAccounts();
  const nickList = accounts.map((a) => `#${a.id} ${a.nickname}`).join(", ") || "(none)";
  console.log(`Database: ${cfg.DATABASE_PATH} (${accounts.length} account(s): ${nickList})`);
  const enc = encryptionKeyStatus();
  if (enc.ok) {
    console.log(`ENCRYPTION_KEY: OK (${projectRoot()})`);
  } else {
    console.warn(`WARNING: ${enc.reason} — /account add and dashboard saves will fail until fixed.`);
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
  await startDiscordSidecar();
  await engine.start();
}

async function startDiscordSidecar(): Promise<void> {
  if (process.env.DISCORD_BOT_RELAY_URL?.trim()) {
    console.log(
      "[friends-bot] not started — DISCORD_BOT_RELAY_URL is set (relay mode; use npm run discord-bot on relay host)",
    );
    startPilotRelayClient();
    return;
  }
  try {
    await startFriendsDiscordBot();
  } catch (err) {
    console.error(
      "[friends-bot] failed to start:",
      err instanceof Error ? err.message : String(err),
    );
    console.error(
      "[friends-bot] Rain/cases still run. Fix DISCORD_BOT_TOKEN + DISCORD_GUILD_ID, or use DISCORD_REPORT_WEBHOOK only.",
    );
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
