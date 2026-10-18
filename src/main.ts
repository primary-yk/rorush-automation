import "./bootstrap-env.js";
import { closeDb, getDb } from "./db/database.js";
import { startApiServer } from "./api/server.js";
import { engine } from "./worker/engine.js";
import { loadConfig, projectRoot } from "./config.js";
import { listAccounts } from "./db/repositories.js";
import { startPilotRelayClient, stopPilotRelayClient } from "./relay/pilot-client.js";

process.on("uncaughtException", (err) => {
  console.error("[fatal]", err.message);
});

process.on("unhandledRejection", (err) => {
  console.error("[unhandled]", err instanceof Error ? err.message : String(err));
});

async function main() {
  getDb();
  const cfg = loadConfig();
  await startApiServer();
  console.log(`Automation API listening on http://${cfg.AUTOMATION_API_HOST}:${cfg.AUTOMATION_API_PORT}`);
  console.log(`Database: ${cfg.DATABASE_PATH} (${listAccounts().length} account(s))`);
  if (!cfg.ENCRYPTION_KEY?.trim()) {
    console.warn("WARNING: ENCRYPTION_KEY missing in .env — you cannot save RoRush accounts until it is set.");
  }
  const rainAccounts = listAccounts().filter((a) => a.join_rain);
  if (rainAccounts.length > 0 && !cfg.CAPMONSTER_API_KEY) {
    console.warn(
      "WARNING: CAPMONSTER_API_KEY missing in .env — rain join will fail until you add a CapMonster key and restart.",
    );
  }
  console.log(`Project root: ${projectRoot()}`);
  void engine.start();
  startPilotRelayClient();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

process.on("SIGINT", async () => {
  stopPilotRelayClient();
  await engine.stop();
  closeDb();
  process.exit(0);
});

process.on("SIGTERM", async () => {
  stopPilotRelayClient();
  await engine.stop();
  closeDb();
  process.exit(0);
});
