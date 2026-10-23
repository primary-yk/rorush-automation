import Database from "better-sqlite3";
import fs from "node:fs";
import path from "node:path";
import { effectiveLimboMinBetCoins, LIMBO_MIN_MULTIPLIER, loadConfig } from "../config.js";
import { SCHEMA_SQL } from "./schema.js";

let db: Database.Database | null = null;

function applyDbPragmas(database: Database.Database): void {
  database.pragma("journal_mode = WAL");
  database.pragma("foreign_keys = ON");
  database.pragma("busy_timeout = 8000");
}

/** Read-only handle for `npm run rain-joins` while `npm run dev` is up (avoids migration + write locks). */
export function openReadonlyDb(): Database.Database {
  const cfg = loadConfig();
  const database = new Database(cfg.DATABASE_PATH, { readonly: true, fileMustExist: true });
  applyDbPragmas(database);
  return database;
}

export function getDb(): Database.Database {
  if (!db) {
    const cfg = loadConfig();
    const dir = path.dirname(cfg.DATABASE_PATH);
    fs.mkdirSync(dir, { recursive: true });
    db = new Database(cfg.DATABASE_PATH);
    applyDbPragmas(db);
    db.exec(SCHEMA_SQL);
    migrateSettings(db);
    migrateAccounts(db);
    migrateRainJoins(db);
    migrateDiscordSeats(db);
    migrateDiscordFriendsLayout(db);
  }
  return db;
}

function migrateRainJoins(db: Database.Database): void {
  const cols = new Set(
    (db.prepare("PRAGMA table_info(rain_joins)").all() as Array<{ name: string }>).map((c) => c.name),
  );
  if (!cols.has("balance_before_coins")) {
    db.exec("ALTER TABLE rain_joins ADD COLUMN balance_before_coins REAL");
  }
}

function migrateDiscordSeats(db: Database.Database): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS discord_user_licenses (
      discord_user_id TEXT PRIMARY KEY,
      license_id TEXT NOT NULL,
      plan TEXT NOT NULL,
      exp INTEGER NOT NULL,
      license_key_enc TEXT NOT NULL,
      license_payload_json TEXT NOT NULL,
      activated_at TEXT NOT NULL
    );
  `);
}

function migrateAccounts(db: Database.Database): void {
  const cols = new Set(
    (db.prepare("PRAGMA table_info(accounts)").all() as Array<{ name: string }>).map((c) => c.name),
  );
  const add: Array<[string, string]> = [
    ["owner_discord_id", "TEXT"],
    ["limbo_wager_enabled", "INTEGER NOT NULL DEFAULT 1"],
    ["limbo_multiplier", "REAL NOT NULL DEFAULT 1.3"],
    ["limbo_bet_coins", "REAL NOT NULL DEFAULT 5"],
    ["pre_wager_before_rain", "INTEGER NOT NULL DEFAULT 0"],
    ["mines_auto_enabled", "INTEGER NOT NULL DEFAULT 0"],
    ["mines_count", "INTEGER NOT NULL DEFAULT 3"],
    ["mines_target_multiplier", "REAL NOT NULL DEFAULT 2"],
    ["mines_random_tiles", "INTEGER NOT NULL DEFAULT 1"],
    ["mines_auto_rains_remaining", "INTEGER NOT NULL DEFAULT 0"],
    ["mines_wallet_mode", "TEXT NOT NULL DEFAULT 'coin'"],
    ["auto_vault_deposit", "INTEGER NOT NULL DEFAULT 0"],
    ["vault_lock_minutes", "INTEGER NOT NULL DEFAULT 0"],
    ["vault_lock_expires_at", "TEXT"],
    ["vault_session_auto_deposit", "INTEGER NOT NULL DEFAULT 0"],
    ["vault_balance", "REAL"],
    ["wallet_balance_token", "TEXT"],
    ["automation_paused", "INTEGER NOT NULL DEFAULT 0"],
    ["schedule_ends_at_ms", "INTEGER"],
  ];
  for (const [name, type] of add) {
    if (!cols.has(name)) {
      db.exec(`ALTER TABLE accounts ADD COLUMN ${name} ${type}`);
    }
  }
  if (cols.has("limbo_multiplier")) {
    db.prepare("UPDATE accounts SET limbo_multiplier = ? WHERE limbo_multiplier < ?").run(
      LIMBO_MIN_MULTIPLIER,
      LIMBO_MIN_MULTIPLIER,
    );
  }
  if (cols.has("limbo_bet_coins")) {
    const minBet = effectiveLimboMinBetCoins();
    db.prepare("UPDATE accounts SET limbo_bet_coins = ? WHERE limbo_bet_coins < ?").run(
      minBet,
      minBet,
    );
  }
  if (cols.has("join_rain")) {
    db.prepare("UPDATE accounts SET join_rain = 1 WHERE join_rain IS NULL").run();
  }
  if (cols.has("mines_auto_enabled")) {
    db.prepare(
      "UPDATE accounts SET mines_auto_enabled = 0, mines_auto_rains_remaining = 0 WHERE mines_auto_enabled != 0 OR mines_auto_rains_remaining != 0",
    ).run();
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
    ["discord_activity_feed_enabled", "INTEGER NOT NULL DEFAULT 0"],
    ["discord_thread_parent_id", "TEXT"],
    ["discord_host_log_channel_id", "TEXT"],
    ["discord_server_layout_json", "TEXT"],
  ];
  for (const [name, type] of add) {
    if (!cols.has(name)) {
      db.exec(`ALTER TABLE settings ADD COLUMN ${name} ${type}`);
    }
  }
}

function migrateDiscordFriendsLayout(db: Database.Database): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS discord_user_threads (
      discord_user_id TEXT PRIMARY KEY,
      thread_id TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
  `);
}

export function closeDb(): void {
  db?.close();
  db = null;
}
