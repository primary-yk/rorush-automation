import Database from "better-sqlite3";
import fs from "node:fs";
import path from "node:path";
import { loadConfig } from "../config.js";
import { SCHEMA_SQL } from "./schema.js";

let db: Database.Database | null = null;

export function getDb(): Database.Database {
  if (!db) {
    const cfg = loadConfig();
    const dir = path.dirname(cfg.DATABASE_PATH);
    fs.mkdirSync(dir, { recursive: true });
    db = new Database(cfg.DATABASE_PATH);
    db.pragma("journal_mode = WAL");
    db.pragma("foreign_keys = ON");
    db.exec(SCHEMA_SQL);
    migrateSettings(db);
    migrateAccounts(db);
  }
  return db;
}

function migrateAccounts(db: Database.Database): void {
  const cols = new Set(
    (db.prepare("PRAGMA table_info(accounts)").all() as Array<{ name: string }>).map((c) => c.name),
  );
  const add: Array<[string, string]> = [
    ["limbo_wager_enabled", "INTEGER NOT NULL DEFAULT 1"],
    ["limbo_multiplier", "REAL NOT NULL DEFAULT 1.1"],
    ["limbo_bet_coins", "REAL NOT NULL DEFAULT 1"],
  ];
  for (const [name, type] of add) {
    if (!cols.has(name)) {
      db.exec(`ALTER TABLE accounts ADD COLUMN ${name} ${type}`);
    }
  }
}

function migrateSettings(db: Database.Database): void {
  const cols = new Set(
    (db.prepare("PRAGMA table_info(settings)").all() as Array<{ name: string }>).map((c) => c.name),
  );
  const add: Array<[string, string]> = [
    ["license_key_enc", "TEXT"],
    ["license_payload_json", "TEXT"],
    ["license_id", "TEXT"],
    ["license_plan", "TEXT"],
    ["license_exp", "INTEGER"],
    ["discord_report_enabled", "INTEGER NOT NULL DEFAULT 0"],
    ["discord_report_webhook_enc", "TEXT"],
  ];
  for (const [name, type] of add) {
    if (!cols.has(name)) {
      db.exec(`ALTER TABLE settings ADD COLUMN ${name} ${type}`);
    }
  }
}

export function closeDb(): void {
  db?.close();
  db = null;
}
