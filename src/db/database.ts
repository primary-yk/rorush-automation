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
  }
  return db;
}

export function closeDb(): void {
  db?.close();
  db = null;
}
