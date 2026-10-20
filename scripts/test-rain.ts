/**
 * Live rain test — run while RoRush may have an active or upcoming rain.
 *
 *   npx tsx scripts/test-rain.ts              # listen 3 min, log hub events
 *   npx tsx scripts/test-rain.ts --join       # also attempt join on join stage (needs CAPTCHA_API_KEY)
 *   npx tsx scripts/test-rain.ts --any        # use first account even if Join rain is off (listen/login test)
 */
import "../src/bootstrap-env.js";
import { getDb } from "../src/db/database.js";
import { listAccounts } from "../src/db/repositories.js";
import { ensureAuthenticated } from "../src/accounts/session-manager.js";
import { joinRainForAccount, parseRain, rainJoinWindowOpen } from "../src/automation/rain-join.js";
import { RoRushHub } from "../src/rorush/signalr-hub.js";
import { SIGNALR } from "../src/rorush/endpoints.js";
import { captchaApiKey, loadConfig, projectRoot } from "../src/config.js";

const attemptJoin = process.argv.includes("--join");
const useAnyAccount = process.argv.includes("--any");
const listenMs = Number(process.env.RAIN_TEST_LISTEN_MS ?? 180_000);

function rainEnabled(row: { join_rain: number }): boolean {
  return Number(row.join_rain) !== 0;
}

async function main() {
  getDb();
  const cfg = loadConfig();
  console.log("Project folder:", projectRoot());
  console.log("Database file:", cfg.DATABASE_PATH);
  console.log("");

  const all = listAccounts();
  if (all.length === 0) {
    console.error("No RoRush accounts in the database.");
    console.error("Add one at http://127.0.0.1:43123 (run npm run dev first).");
    process.exit(1);
  }

  const withRain = all.filter((a) => rainEnabled(a));
  if (withRain.length === 0 && !useAnyAccount) {
    console.error("No accounts with Join rain enabled in THIS database file.\n");
    for (const a of all) {
      console.error(`  • #${a.id} ${a.nickname} — join_rain=${rainEnabled(a) ? "on" : "OFF"} (raw=${a.join_rain})`);
    }
    console.error("\nFix: open dashboard → Accounts → turn ON “Join rain” for your account.");
    console.error("Or run: npx tsx scripts/test-rain.ts --any   (login + listen only, no join unless --join)");
    process.exit(1);
  }

  const account = (withRain[0] ?? all[0])!;
  if (!rainEnabled(account) && useAnyAccount) {
    console.warn("Note: Join rain is OFF for this account — use --join only after enabling it in the dashboard.");
  }
  console.log(`Using account #${account.id} (${account.nickname})`);

  if (attemptJoin && !captchaApiKey(cfg)) {
    console.error("Set CAPTCHA_API_KEY (+ CAPTCHA_PROVIDER=2captcha) in .env before using --join");
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
    console.log("Join stage fields:", {
      joinStart: rain.joinStageStartTimestamp,
      joinDur: rain.joinStageDuration,
      windowOpen: rainJoinWindowOpen(rain),
    });
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
