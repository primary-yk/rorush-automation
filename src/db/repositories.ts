import { getDb } from "./database.js";

export type AccountRow = {
  id: number;
  nickname: string;
  username: string | null;
  password_enc: string | null;
  session_jwt_enc: string | null;
  api_key_enc: string | null;
  proxy_url: string | null;
  join_rain: number;
  min_rain_amount: number;
  auto_open_cases: number;
  auto_redeem_codes: number;
  min_code_level: number;
  limbo_wager_enabled: number;
  limbo_multiplier: number;
  limbo_bet_coins: number;
  status: string;
  last_error: string | null;
  balance: number | null;
  level: number | null;
  lifetime_rain: number;
  lifetime_cases: number;
  lifetime_codes: number;
  created_at: string;
  updated_at: string;
};

export type SettingsRow = {
  id: number;
  global_pause: number;
  discord_enabled: number;
  discord_channel_id: string | null;
  discord_token_enc: string | null;
  discord_report_enabled: number;
  discord_report_webhook_enc: string | null;
  discord_activity_feed_enabled: number;
  license_key_enc: string | null;
  license_payload_json: string | null;
  license_id: string | null;
  license_plan: string | null;
  license_exp: number | null;
  updated_at: string;
};

export function getSettings(): SettingsRow {
  return getDb().prepare("SELECT * FROM settings WHERE id = 1").get() as SettingsRow;
}

export function updateSettings(patch: Partial<Omit<SettingsRow, "id">>): SettingsRow {
  const current = getSettings();
  const next = { ...current, ...patch, updated_at: new Date().toISOString() };
  getDb()
    .prepare(
      `UPDATE settings SET global_pause = ?, discord_enabled = ?, discord_channel_id = ?,
       discord_token_enc = ?, discord_report_enabled = ?, discord_report_webhook_enc = ?,
       discord_activity_feed_enabled = ?,
       license_key_enc = ?, license_payload_json = ?,
       license_id = ?, license_plan = ?, license_exp = ?, updated_at = ? WHERE id = 1`,
    )
    .run(
      next.global_pause,
      next.discord_enabled,
      next.discord_channel_id,
      next.discord_token_enc,
      next.discord_report_enabled ?? 0,
      next.discord_report_webhook_enc ?? null,
      next.discord_activity_feed_enabled ?? 0,
      next.license_key_enc ?? null,
      next.license_payload_json ?? null,
      next.license_id ?? null,
      next.license_plan ?? null,
      next.license_exp ?? null,
      next.updated_at,
    );
  return getSettings();
}

export function listAccounts(): AccountRow[] {
  return getDb().prepare("SELECT * FROM accounts ORDER BY id").all() as AccountRow[];
}

export function getAccount(id: number): AccountRow | undefined {
  return getDb().prepare("SELECT * FROM accounts WHERE id = ?").get(id) as AccountRow | undefined;
}

export function insertAccount(input: {
  nickname: string;
  username?: string | null;
  password_enc?: string | null;
  session_jwt_enc?: string | null;
  api_key_enc?: string | null;
  proxy_url?: string | null;
}): AccountRow {
  const now = new Date().toISOString();
  const info = getDb()
    .prepare(
      `INSERT INTO accounts (nickname, username, password_enc, session_jwt_enc, api_key_enc, proxy_url, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(
      input.nickname,
      input.username ?? null,
      input.password_enc ?? null,
      input.session_jwt_enc ?? null,
      input.api_key_enc ?? null,
      input.proxy_url ?? null,
      now,
      now,
    );
  return getAccount(Number(info.lastInsertRowid))!;
}

export function updateAccount(
  id: number,
  patch: Partial<Omit<AccountRow, "id" | "created_at">>,
): AccountRow | undefined {
  const current = getAccount(id);
  if (!current) return undefined;
  const next = { ...current, ...patch, updated_at: new Date().toISOString() };
  getDb()
    .prepare(
      `UPDATE accounts SET nickname = ?, username = ?, password_enc = ?, session_jwt_enc = ?, api_key_enc = ?,
       proxy_url = ?, join_rain = ?, min_rain_amount = ?, auto_open_cases = ?, auto_redeem_codes = ?,
       min_code_level = ?, limbo_wager_enabled = ?, limbo_multiplier = ?, limbo_bet_coins = ?,
       status = ?, last_error = ?, balance = ?, level = ?,
       lifetime_rain = ?, lifetime_cases = ?, lifetime_codes = ?, updated_at = ?
       WHERE id = ?`,
    )
    .run(
      next.nickname,
      next.username,
      next.password_enc,
      next.session_jwt_enc,
      next.api_key_enc,
      next.proxy_url,
      next.join_rain,
      next.min_rain_amount,
      next.auto_open_cases,
      next.auto_redeem_codes,
      next.min_code_level,
      next.limbo_wager_enabled,
      next.limbo_multiplier,
      next.limbo_bet_coins,
      next.status,
      next.last_error,
      next.balance,
      next.level,
      next.lifetime_rain,
      next.lifetime_cases,
      next.lifetime_codes,
      next.updated_at,
      id,
    );
  return getAccount(id);
}

export function deleteAccount(id: number): void {
  getDb().prepare("DELETE FROM accounts WHERE id = ?").run(id);
}

export function appendLog(input: {
  accountId?: number | null;
  category: string;
  message: string;
  detail?: string | null;
}): void {
  getDb()
    .prepare(
      "INSERT INTO activity_log (account_id, category, message, detail, created_at) VALUES (?, ?, ?, ?, ?)",
    )
    .run(
      input.accountId ?? null,
      input.category,
      input.message,
      input.detail ?? null,
      new Date().toISOString(),
    );
  void import("../discord/activity-feed.js")
    .then((m) =>
      m.onActivityLog({
        account_id: input.accountId ?? null,
        category: input.category,
        message: input.message,
        detail: input.detail ?? null,
        created_at: new Date().toISOString(),
      }),
    )
    .catch(() => undefined);
}

export function listLogs(limit = 200): Array<{
  id: number;
  account_id: number | null;
  category: string;
  message: string;
  detail: string | null;
  created_at: string;
}> {
  return getDb()
    .prepare("SELECT * FROM activity_log ORDER BY id DESC LIMIT ?")
    .all(limit) as Array<{
    id: number;
    account_id: number | null;
    category: string;
    message: string;
    detail: string | null;
    created_at: string;
  }>;
}

export function recordRainJoin(input: {
  accountId: number;
  rainId: string;
  amount: number | null;
  success: boolean;
  reason: string | null;
}): void {
  getDb()
    .prepare(
      "INSERT INTO rain_joins (account_id, rain_id, amount, success, reason, created_at) VALUES (?, ?, ?, ?, ?, ?)",
    )
    .run(
      input.accountId,
      input.rainId,
      input.amount,
      input.success ? 1 : 0,
      input.reason,
      new Date().toISOString(),
    );
}

export function recordCaseOpen(input: {
  accountId: number;
  caseId: string;
  caseKind: string;
  rewardAmount: number | null;
  success: boolean;
  reason: string | null;
}): void {
  getDb()
    .prepare(
      `INSERT INTO case_opens (account_id, case_id, case_kind, reward_amount, success, reason, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(
      input.accountId,
      input.caseId,
      input.caseKind,
      input.rewardAmount,
      input.success ? 1 : 0,
      input.reason,
      new Date().toISOString(),
    );
}

export function recordCodeRedeem(input: {
  accountId: number;
  code: string;
  success: boolean;
  siteMessage: string | null;
  rewardAmount: number | null;
}): void {
  getDb()
    .prepare(
      `INSERT INTO code_redeems (account_id, code, success, site_message, reward_amount, created_at)
       VALUES (?, ?, ?, ?, ?, ?)`,
    )
    .run(
      input.accountId,
      input.code,
      input.success ? 1 : 0,
      input.siteMessage,
      input.rewardAmount,
      new Date().toISOString(),
    );
}

export function upsertCaseSchedule(input: {
  accountId: number;
  caseId: string;
  caseKind: string;
  unlockAtMs: number;
  meta?: unknown;
}): void {
  getDb()
    .prepare(
      `INSERT INTO account_case_schedule (account_id, case_id, case_kind, unlock_at_ms, meta_json)
       VALUES (?, ?, ?, ?, ?)
       ON CONFLICT(account_id, case_id) DO UPDATE SET
         case_kind = excluded.case_kind,
         unlock_at_ms = excluded.unlock_at_ms,
         meta_json = excluded.meta_json`,
    )
    .run(
      input.accountId,
      input.caseId,
      input.caseKind,
      input.unlockAtMs,
      input.meta ? JSON.stringify(input.meta) : null,
    );
}

export function listDueCases(nowMs: number): Array<{
  account_id: number;
  case_id: string;
  case_kind: string;
  unlock_at_ms: number;
  meta_json: string | null;
}> {
  return getDb()
    .prepare("SELECT * FROM account_case_schedule WHERE unlock_at_ms <= ? ORDER BY unlock_at_ms")
    .all(nowMs) as Array<{
    account_id: number;
    case_id: string;
    case_kind: string;
    unlock_at_ms: number;
    meta_json: string | null;
  }>;
}

export function removeCaseSchedule(accountId: number, caseId: string): void {
  getDb()
    .prepare("DELETE FROM account_case_schedule WHERE account_id = ? AND case_id = ?")
    .run(accountId, caseId);
}

export function purgeDisallowedCaseSchedules(accountId: number, allowedKinds: readonly string[]): void {
  if (allowedKinds.length === 0) return;
  const placeholders = allowedKinds.map(() => "?").join(", ");
  getDb()
    .prepare(
      `DELETE FROM account_case_schedule WHERE account_id = ? AND case_kind NOT IN (${placeholders})`,
    )
    .run(accountId, ...allowedKinds);
}

export function nextCaseUnlockMs(): number | null {
  const row = getDb()
    .prepare("SELECT MIN(unlock_at_ms) AS t FROM account_case_schedule")
    .get() as { t: number | null };
  return row.t;
}

export function markDiscordCodeSeen(code: string): boolean {
  try {
    getDb()
      .prepare("INSERT INTO seen_discord_codes (code, first_seen_at) VALUES (?, ?)")
      .run(code, new Date().toISOString());
    return true;
  } catch {
    return false;
  }
}

export function listRecentRainJoins(accountId: number, limit = 20) {
  return getDb()
    .prepare("SELECT * FROM rain_joins WHERE account_id = ? ORDER BY id DESC LIMIT ?")
    .all(accountId, limit);
}

export function listRecentCaseOpens(accountId: number, limit = 20) {
  return getDb()
    .prepare("SELECT * FROM case_opens WHERE account_id = ? ORDER BY id DESC LIMIT ?")
    .all(accountId, limit);
}

export function listRecentCodeRedeems(accountId: number, limit = 20) {
  return getDb()
    .prepare("SELECT * FROM code_redeems WHERE account_id = ? ORDER BY id DESC LIMIT ?")
    .all(accountId, limit);
}
