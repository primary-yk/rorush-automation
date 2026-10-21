export const SCHEMA_SQL = `
CREATE TABLE IF NOT EXISTS settings (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  global_pause INTEGER NOT NULL DEFAULT 0,
  discord_enabled INTEGER NOT NULL DEFAULT 0,
  discord_channel_id TEXT,
  discord_token_enc TEXT,
  discord_report_enabled INTEGER NOT NULL DEFAULT 0,
  discord_report_webhook_enc TEXT,
  discord_activity_feed_enabled INTEGER NOT NULL DEFAULT 0,
  license_key_enc TEXT,
  license_payload_json TEXT,
  license_id TEXT,
  license_plan TEXT,
  license_exp INTEGER,
  updated_at TEXT NOT NULL
);

INSERT OR IGNORE INTO settings (id, global_pause, discord_enabled, updated_at)
VALUES (1, 0, 0, datetime('now'));

CREATE TABLE IF NOT EXISTS accounts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  nickname TEXT NOT NULL,
  owner_discord_id TEXT,
  username TEXT,
  password_enc TEXT,
  session_jwt_enc TEXT,
  api_key_enc TEXT,
  proxy_url TEXT,
  join_rain INTEGER NOT NULL DEFAULT 1,
  min_rain_amount REAL NOT NULL DEFAULT 0,
  auto_open_cases INTEGER NOT NULL DEFAULT 1,
  auto_redeem_codes INTEGER NOT NULL DEFAULT 0,
  min_code_level INTEGER NOT NULL DEFAULT 0,
  limbo_wager_enabled INTEGER NOT NULL DEFAULT 1,
  limbo_multiplier REAL NOT NULL DEFAULT 1.3,
  limbo_bet_coins REAL NOT NULL DEFAULT 1,
  pre_wager_before_rain INTEGER NOT NULL DEFAULT 0,
  automation_paused INTEGER NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'idle',
  last_error TEXT,
  balance REAL,
  level INTEGER,
  lifetime_rain REAL NOT NULL DEFAULT 0,
  lifetime_cases REAL NOT NULL DEFAULT 0,
  lifetime_codes REAL NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS activity_log (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  account_id INTEGER,
  category TEXT NOT NULL,
  message TEXT NOT NULL,
  detail TEXT,
  created_at TEXT NOT NULL,
  FOREIGN KEY (account_id) REFERENCES accounts(id) ON DELETE SET NULL
);

CREATE TABLE IF NOT EXISTS rain_joins (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  account_id INTEGER NOT NULL,
  rain_id TEXT NOT NULL,
  amount REAL,
  success INTEGER NOT NULL,
  reason TEXT,
  balance_before_coins REAL,
  created_at TEXT NOT NULL,
  FOREIGN KEY (account_id) REFERENCES accounts(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS case_opens (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  account_id INTEGER NOT NULL,
  case_id TEXT NOT NULL,
  case_kind TEXT NOT NULL,
  reward_amount REAL,
  success INTEGER NOT NULL,
  reason TEXT,
  created_at TEXT NOT NULL,
  FOREIGN KEY (account_id) REFERENCES accounts(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS code_redeems (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  account_id INTEGER NOT NULL,
  code TEXT NOT NULL,
  success INTEGER NOT NULL,
  site_message TEXT,
  reward_amount REAL,
  created_at TEXT NOT NULL,
  FOREIGN KEY (account_id) REFERENCES accounts(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS seen_discord_codes (
  code TEXT PRIMARY KEY,
  first_seen_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS account_case_schedule (
  account_id INTEGER NOT NULL,
  case_id TEXT NOT NULL,
  case_kind TEXT NOT NULL,
  unlock_at_ms INTEGER NOT NULL,
  meta_json TEXT,
  PRIMARY KEY (account_id, case_id),
  FOREIGN KEY (account_id) REFERENCES accounts(id) ON DELETE CASCADE
);
`;
