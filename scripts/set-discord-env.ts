/**
 * Merge Discord vars into .env (creates .env from .env.example if missing).
 * Usage:
 *   npx tsx scripts/set-discord-env.ts --token 'BOT_TOKEN' --guild SERVER_ID --host YOUR_USER_ID
 */
import fs from "node:fs";
import path from "node:path";
import { projectRoot } from "../src/config.js";

function parseArgs(): { token: string; guild: string; host: string } {
  const argv = process.argv.slice(2);
  const get = (flag: string): string | undefined => {
    const i = argv.indexOf(flag);
    return i >= 0 ? argv[i + 1]?.trim() : undefined;
  };
  const token = get("--token") ?? process.env.DISCORD_BOT_TOKEN?.trim();
  const guild = get("--guild") ?? process.env.DISCORD_GUILD_ID?.trim();
  const host = get("--host") ?? process.env.HOST_DISCORD_USER_ID?.trim();
  if (!token || !guild || !host) {
    console.error(
      "Usage: npx tsx scripts/set-discord-env.ts --token '…' --guild SERVER_ID --host YOUR_DISCORD_USER_ID",
    );
    process.exit(1);
  }
  return { token, guild, host };
}

function upsertLines(content: string, pairs: Record<string, string>): string {
  const lines = content.length ? content.replace(/\r\n/g, "\n").split("\n") : [];
  for (const [key, value] of Object.entries(pairs)) {
    const prefix = `${key}=`;
    const next = `${prefix}${value}`;
    const idx = lines.findIndex((l) => l.startsWith(prefix) || l.startsWith(`# ${key}=`));
    if (idx >= 0) lines[idx] = next;
    else lines.push(next);
  }
  return `${lines.filter((l, i, a) => l.length > 0 || i < a.length - 1).join("\n").trimEnd()}\n`;
}

const root = projectRoot();
const envPath = path.join(root, ".env");
const examplePath = path.join(root, ".env.example");

let content = "";
if (fs.existsSync(envPath)) {
  content = fs.readFileSync(envPath, "utf8");
} else if (fs.existsSync(examplePath)) {
  content = fs.readFileSync(examplePath, "utf8");
  console.log("Created .env from .env.example — fill ENCRYPTION_KEY + CAPTCHA if still empty.");
}

const { token, guild, host } = parseArgs();
const merged = upsertLines(content, {
  DISCORD_BOT_TOKEN: token,
  DISCORD_GUILD_ID: guild,
  HOST_DISCORD_USER_ID: host,
});

fs.writeFileSync(envPath, merged, { mode: 0o600 });
console.log(`Updated ${envPath}`);
console.log("  DISCORD_BOT_TOKEN=…");
console.log(`  DISCORD_GUILD_ID=${guild}`);
console.log(`  HOST_DISCORD_USER_ID=${host}`);
if (!/ENCRYPTION_KEY=\S+/.test(merged)) {
  console.warn("\nWARNING: ENCRYPTION_KEY is still empty — run: openssl rand -base64 32");
  console.warn("Then add ENCRYPTION_KEY=… to .env before /account add.");
}
