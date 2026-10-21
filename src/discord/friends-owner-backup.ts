import fs from "node:fs";
import { loadConfig } from "../config.js";
import {
  getSettings,
  listAccounts,
  listDiscordUserThreads,
  type AccountRow,
  type SettingsRow,
} from "../db/repositories.js";

export type HostBackupPayload = {
  exportedAt: string;
  schemaVersion: 1;
  note: "Encrypted credentials — restore on host with same ENCRYPTION_KEY",
  accounts: Array<
    Pick<
      AccountRow,
      | "nickname"
      | "owner_discord_id"
      | "username"
      | "password_enc"
      | "session_jwt_enc"
      | "api_key_enc"
      | "proxy_url"
      | "join_rain"
      | "min_rain_amount"
      | "auto_open_cases"
      | "auto_redeem_codes"
      | "min_code_level"
      | "limbo_wager_enabled"
      | "limbo_multiplier"
      | "limbo_bet_coins"
      | "pre_wager_before_rain"
      | "auto_vault_deposit"
      | "vault_lock_minutes"
      | "vault_lock_expires_at"
      | "vault_session_auto_deposit"
      | "automation_paused"
    >
  >;
  settings: Pick<
    SettingsRow,
    | "global_pause"
    | "discord_thread_parent_id"
    | "discord_host_log_channel_id"
    | "discord_server_layout_json"
  >;
  discord_user_threads: ReturnType<typeof listDiscordUserThreads>;
};

export function buildHostBackupPayload(): HostBackupPayload {
  const accounts = listAccounts().map((a) => ({
    nickname: a.nickname,
    owner_discord_id: a.owner_discord_id,
    username: a.username,
    password_enc: a.password_enc,
    session_jwt_enc: a.session_jwt_enc,
    api_key_enc: a.api_key_enc,
    proxy_url: a.proxy_url,
    join_rain: a.join_rain,
    min_rain_amount: a.min_rain_amount,
    auto_open_cases: a.auto_open_cases,
    auto_redeem_codes: a.auto_redeem_codes,
    min_code_level: a.min_code_level,
    limbo_wager_enabled: a.limbo_wager_enabled,
    limbo_multiplier: a.limbo_multiplier,
    limbo_bet_coins: a.limbo_bet_coins,
    pre_wager_before_rain: a.pre_wager_before_rain,
    auto_vault_deposit: a.auto_vault_deposit,
    vault_lock_minutes: a.vault_lock_minutes,
    vault_lock_expires_at: a.vault_lock_expires_at,
    vault_session_auto_deposit: a.vault_session_auto_deposit,
    automation_paused: a.automation_paused,
  }));
  const s = getSettings();
  return {
    exportedAt: new Date().toISOString(),
    schemaVersion: 1,
    note: "Encrypted credentials — restore on host with same ENCRYPTION_KEY",
    accounts,
    settings: {
      global_pause: s.global_pause,
      discord_thread_parent_id: s.discord_thread_parent_id,
      discord_host_log_channel_id: s.discord_host_log_channel_id,
      discord_server_layout_json: s.discord_server_layout_json,
    },
    discord_user_threads: listDiscordUserThreads(),
  };
}

export function writeHostBackupFile(): { path: string; filename: string } {
  const cfg = loadConfig();
  const payload = buildHostBackupPayload();
  const dir = `${cfg.DATABASE_PATH}.backups`;
  fs.mkdirSync(dir, { recursive: true });
  const stamp = payload.exportedAt.replace(/[:.]/g, "-");
  const filename = `rush-pilot-host-backup-${stamp}.json`;
  const path = `${dir}/${filename}`;
  fs.writeFileSync(path, JSON.stringify(payload, null, 2), "utf8");
  return { path, filename };
}
