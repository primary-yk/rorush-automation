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
  }
  return db;
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
