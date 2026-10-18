/**
 * Live rain test — run while RoRush may have an active or upcoming rain.
 *
 *   npx tsx scripts/test-rain.ts              # listen 3 min, log hub events
 *   npx tsx scripts/test-rain.ts --join       # also attempt join on join stage (needs CAPMONSTER_API_KEY)
 */
import "../src/bootstrap-env.js";
import { getDb } from "../src/db/database.js";
import { listAccounts } from "../src/db/repositories.js";
import { ensureAuthenticated } from "../src/accounts/session-manager.js";
import { joinRainForAccount, parseRain, rainJoinWindowOpen } from "../src/automation/rain-join.js";
import { RoRushHub } from "../src/rorush/signalr-hub.js";
import { SIGNALR } from "../src/rorush/endpoints.js";
import { loadConfig } from "../src/config.js";

const attemptJoin = process.argv.includes("--join");
const listenMs = Number(process.env.RAIN_TEST_LISTEN_MS ?? 180_000);

async function main() {
  getDb();
  const accounts = listAccounts().filter((a) => a.join_rain);
  if (accounts.length === 0) {
    console.error("No accounts with join_rain enabled in the database.");
    process.exit(1);
  }
  const account = accounts[0]!;
  console.log(`Using account #${account.id} (${account.nickname})`);

  const cfg = loadConfig();
  if (attemptJoin && !cfg.CAPMONSTER_API_KEY) {
    console.error("Set CAPMONSTER_API_KEY in .env before using --join");
    process.exit(1);
  }

  console.log("Logging in to RoRush…");
  const { creds } = await ensureAuthenticated(account.id);
  console.log("Login OK.");

  const listenerHub = new RoRushHub(creds, {}, account.proxy_url);
  await listenerHub.connect();
  await listenerHub.subscribeRain();
  console.log("SignalR connected + SubscribeRain OK. Listening for rain events…\n");

  let joinHub: RoRushHub | null = null;
  let joinedThisRain = false;

  const logEvent = (name: string, payload: unknown) => {
    const preview = JSON.stringify(payload).slice(0, 200);
    console.log(`[${new Date().toISOString()}] ${name}`, preview);
  };

  listenerHub.on(SIGNALR.rain.receiveCurrent, (p) => logEvent("ReceiveCurrentRains", p));
  listenerHub.on(SIGNALR.rain.receiveCreated, (p) => logEvent("ReceiveRainCreated", p));
  listenerHub.on(SIGNALR.rain.receiveJoinStageStart, (p) => logEvent("ReceiveRainJoinStageStart", p));
  listenerHub.on(SIGNALR.rain.receiveAmountUpdated, (p) => logEvent("ReceiveRainAmountUpdated", p));
  listenerHub.on(SIGNALR.rain.receiveFinished, (p) => logEvent("ReceiveRainFinished", p));

  listenerHub.on(SIGNALR.rain.receiveJoinStageStart, (payload) => {
    const rain = parseRain(payload);
    if (!rain || joinedThisRain || !attemptJoin) return;
    if (!rainJoinWindowOpen(rain)) {
      console.log("Join stage event but window not open yet — waiting.");
      return;
    }
    joinedThisRain = true;
    void (async () => {
      console.log("\n>>> Join window open — attempting join…");
      joinHub = new RoRushHub(creds, {}, account.proxy_url);
      await joinHub.connect();
      await joinHub.subscribeRain();
      const result = await joinRainForAccount({
        accountId: account.id,
        rain,
        hub: joinHub,
      });
      console.log("\n>>> Join result:", result);
    })();
  });

  console.log(`Will listen for ${listenMs / 1000}s. Use --join to attempt a real join when stage starts.\n`);

  await new Promise((r) => setTimeout(r, listenMs));

  await listenerHub.disconnect();
  await joinHub?.disconnect();
  console.log("\nDone. If you saw no events, no rain ran during this window — run again during chat rain.");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
