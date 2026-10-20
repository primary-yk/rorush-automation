/**
 * Checks friends Discord bot env (does not print secrets).
 * Usage: npm run discord-bot-doctor
 */
import "../src/bootstrap-env.js";

function ok(label: string, pass: boolean, hint?: string): void {
  console.log(`${pass ? "OK" : "MISSING"} — ${label}${hint ? ` (${hint})` : ""}`);
}

const token = process.env.DISCORD_BOT_TOKEN?.trim();
const guild = process.env.DISCORD_GUILD_ID?.trim();
const host = process.env.HOST_DISCORD_USER_ID?.trim();
const relay = process.env.DISCORD_BOT_RELAY_URL?.trim();

ok("DISCORD_BOT_TOKEN", !!token);
ok("DISCORD_GUILD_ID", !!guild);
ok("HOST_DISCORD_USER_ID", !!host, "you — for /pause /resume");
ok("DISCORD_BOT_RELAY_URL unset", !relay, "friends mode — leave relay empty");

if (token && guild) {
  console.log("\nNext: npm run dev — look for [friends-bot] logged in");
} else {
  console.log("\nAdd missing vars to .env, then npm run dev.");
}
