import "./bootstrap-env.js";
import { closeDb, getDb } from "./db/database.js";
import { startApiServer } from "./api/server.js";
import { engine } from "./worker/engine.js";
import { loadConfig } from "./config.js";

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
  void engine.start();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

process.on("SIGINT", async () => {
  await engine.stop();
  closeDb();
  process.exit(0);
});

process.on("SIGTERM", async () => {
  await engine.stop();
  closeDb();
  process.exit(0);
});
