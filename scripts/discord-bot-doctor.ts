/**
 * Checks friends Discord bot env (does not print secrets).
 * Usage: npm run discord-bot-doctor
 */
import "../src/bootstrap-env.js";
import { captchaApiKey, loadConfig } from "../src/config.js";
import {
  serverMembersIntentOptedOut,
  useServerMembersIntent,
} from "../src/discord/friends-member-intent.js";

function ok(label: string, pass: boolean, hint?: string): void {
  console.log(`${pass ? "OK" : "MISSING"} — ${label}${hint ? ` (${hint})` : ""}`);
}

const token = process.env.DISCORD_BOT_TOKEN?.trim();
const guild = process.env.DISCORD_GUILD_ID?.trim();
const host = process.env.HOST_DISCORD_USER_ID?.trim();
const relay = process.env.DISCORD_BOT_RELAY_URL?.trim();
const webhook = process.env.DISCORD_REPORT_WEBHOOK?.trim();

ok("DISCORD_BOT_TOKEN", !!token);
ok("DISCORD_GUILD_ID", !!guild);
ok("HOST_DISCORD_USER_ID", !!host, "you — for /pause /resume");
ok("DISCORD_BOT_RELAY_URL unset", !relay, "friends mode — leave relay empty");
ok("DISCORD_REPORT_WEBHOOK", !!webhook, "optional channel alerts without slash bot");

loadConfig();
ok("Captcha key (CAPTCHA_API_KEY or legacy CAPMONSTER_API_KEY)", !!captchaApiKey());

if (relay) {
  console.log("\nRelay mode: friends slash bot in npm run dev is OFF. Use npm run discord-bot + relay host.");
} else if (token && guild) {
  console.log("\nNext: npm run dev — look for [friends-bot] logged in (before rain engine finishes connecting).");
  console.log("Invite bot: OAuth2 → bot + applications.commands + Manage Channels/Roles/Threads");
  const members = useServerMembersIntent();
  console.log(
    members
      ? "Auto-role on join: ON (GuildMembers) — needs Server Members Intent ON in Developer Portal + npm run dev restart"
      : "Auto-role on join: OFF — remove DISCORD_SERVER_MEMBERS_INTENT=0 or set to 1 after enabling Portal intent",
  );
  if (serverMembersIntentOptedOut()) {
    console.log("  (You set DISCORD_SERVER_MEMBERS_INTENT=0 — delete that line to use Portal intent.)");
  }
  console.log("Staff: /server setup  ·  Friends: /connect → /account add → /rain");
} else if (webhook) {
  console.log("\nWebhook-only mode: [friends-bot] skipped is OK. Slash commands need DISCORD_BOT_TOKEN + DISCORD_GUILD_ID.");
} else {
  console.log("\nAdd DISCORD_BOT_TOKEN + DISCORD_GUILD_ID for slash bot, or DISCORD_REPORT_WEBHOOK for alerts only.");
}
