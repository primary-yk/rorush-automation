import Database from "better-sqlite3";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "data");
const DB_PATH = path.join(DIR, "bot-links.db");

let db: Database.Database | null = null;

export function getBotDb(): Database.Database {
  if (!db) {
    fs.mkdirSync(DIR, { recursive: true });
    db = new Database(DB_PATH);
    db.exec(`
      CREATE TABLE IF NOT EXISTS links (
        discord_user_id TEXT PRIMARY KEY,
        license_id TEXT NOT NULL UNIQUE,
        thread_id TEXT NOT NULL,
        created_at TEXT NOT NULL
      );
    `);
  }
  return db;
}

export type UserLink = {
  discord_user_id: string;
  license_id: string;
  thread_id: string;
  created_at: string;
};

export function upsertLink(input: { discordUserId: string; licenseId: string; threadId: string }): void {
  const now = new Date().toISOString();
  getBotDb()
    .prepare(
      `INSERT INTO links (discord_user_id, license_id, thread_id, created_at)
       VALUES (?, ?, ?, ?)
       ON CONFLICT(discord_user_id) DO UPDATE SET
         license_id = excluded.license_id,
         thread_id = excluded.thread_id,
         created_at = excluded.created_at`,
    )
    .run(input.discordUserId, input.licenseId, input.threadId, now);
}

export function getLinkByLicenseId(licenseId: string): UserLink | undefined {
  return getBotDb().prepare("SELECT * FROM links WHERE license_id = ?").get(licenseId) as UserLink | undefined;
}

export function getLinkByDiscordUser(discordUserId: string): UserLink | undefined {
  return getBotDb().prepare("SELECT * FROM links WHERE discord_user_id = ?").get(discordUserId) as
    | UserLink
    | undefined;
}
