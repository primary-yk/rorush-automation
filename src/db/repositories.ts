import {
  clampLimboBetCoins,
  clampLimboMultiplier,
  effectiveLimboMinBetCoins,
  LIMBO_MIN_MULTIPLIER,
} from "../config.js";
import { getDb } from "./database.js";
import { shouldSkipDuplicateActivityLog } from "./activity-dedupe.js";

export type AccountRow = {
  id: number;
  nickname: string;
  owner_discord_id: string | null;
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
  mines_auto_enabled: number;
  mines_count: number;
  mines_target_multiplier: number;
  mines_random_tiles: number;
  mines_auto_rains_remaining: number;
  mines_wallet_mode: string;
  pre_wager_before_rain: number;
  auto_vault_deposit: number;
  vault_lock_minutes: number;
  vault_lock_expires_at: string | null;
  vault_session_auto_deposit: number;
  automation_paused: number;
  status: string;
  last_error: string | null;
  balance: number | null;
  vault_balance: number | null;
  /** RoRush active wallet: coin (real) or funCoin — from auth status refresh. */
  wallet_balance_token: string | null;
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
  discord_thread_parent_id: string | null;
  discord_host_log_channel_id: string | null;
  discord_server_layout_json: string | null;
  updated_at: string;
};

export type DiscordUserThreadRow = {
  discord_user_id: string;
  thread_id: string;
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
       license_id = ?, license_plan = ?, license_exp = ?,
       discord_thread_parent_id = ?, discord_host_log_channel_id = ?, discord_server_layout_json = ?,
       updated_at = ? WHERE id = 1`,
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
      next.discord_thread_parent_id ?? null,
      next.discord_host_log_channel_id ?? null,
      next.discord_server_layout_json ?? null,
      next.updated_at,
    );
  return getSettings();
}

export function getDiscordUserThread(discordUserId: string): DiscordUserThreadRow | undefined {
  return getDb()
    .prepare("SELECT * FROM discord_user_threads WHERE discord_user_id = ?")
    .get(discordUserId) as DiscordUserThreadRow | undefined;
}

export function listDiscordUserThreads(): DiscordUserThreadRow[] {
  return getDb()
    .prepare("SELECT * FROM discord_user_threads ORDER BY updated_at DESC")
    .all() as DiscordUserThreadRow[];
}

export function clearAllDiscordUserThreads(): void {
  getDb().prepare("DELETE FROM discord_user_threads").run();
}

export function deleteDiscordUserThread(discordUserId: string): void {
  getDb().prepare("DELETE FROM discord_user_threads WHERE discord_user_id = ?").run(discordUserId);
}

export function upsertDiscordUserThread(input: {
  discordUserId: string;
  threadId: string;
}): DiscordUserThreadRow {
  const updated_at = new Date().toISOString();
  getDb()
    .prepare(
      `INSERT INTO discord_user_threads (discord_user_id, thread_id, updated_at)
       VALUES (?, ?, ?)
       ON CONFLICT(discord_user_id) DO UPDATE SET thread_id = excluded.thread_id, updated_at = excluded.updated_at`,
    )
    .run(input.discordUserId, input.threadId, updated_at);
  return getDiscordUserThread(input.discordUserId)!;
}

export function listAccounts(): AccountRow[] {
  return getDb().prepare("SELECT * FROM accounts ORDER BY id").all() as AccountRow[];
}

/** Bumps stored multipliers below {@link LIMBO_MIN_MULTIPLIER} (e.g. after site import). */
export function enforceLimboMultiplierMinimums(): number {
  const minBet = effectiveLimboMinBetCoins();
  const db = getDb();
  const mult = db
    .prepare("UPDATE accounts SET limbo_multiplier = ? WHERE limbo_multiplier < ?")
    .run(LIMBO_MIN_MULTIPLIER, LIMBO_MIN_MULTIPLIER);
  const bet = db
    .prepare("UPDATE accounts SET limbo_bet_coins = ? WHERE limbo_bet_coins < ?")
    .run(minBet, minBet);
  return mult.changes + bet.changes;
}

export function getAccount(id: number): AccountRow | undefined {
  return getDb().prepare("SELECT * FROM accounts WHERE id = ?").get(id) as AccountRow | undefined;
}

export function insertAccount(input: {
  nickname: string;
  owner_discord_id?: string | null;
  username?: string | null;
  password_enc?: string | null;
  session_jwt_enc?: string | null;
  api_key_enc?: string | null;
  proxy_url?: string | null;
}): AccountRow {
  const now = new Date().toISOString();
  const info = getDb()
    .prepare(
      `INSERT INTO accounts (nickname, owner_discord_id, username, password_enc, session_jwt_enc, api_key_enc, proxy_url, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(
      input.nickname,
      input.owner_discord_id ?? null,
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

export type UpdateAccountOptions = {
  /** Only dashboard PATCH, Discord /rain, and backup import may change join_rain. */
  allowJoinRainChange?: boolean;
};

export function updateAccount(
  id: number,
  patch: Partial<Omit<AccountRow, "id" | "created_at">>,
  opts?: UpdateAccountOptions,
): AccountRow | undefined {
  const current = getAccount(id);
  if (!current) return undefined;

  const cleanPatch = { ...patch };
  for (const key of Object.keys(cleanPatch) as (keyof typeof cleanPatch)[]) {
    if (cleanPatch[key] === undefined) delete cleanPatch[key];
  }
  if (!opts?.allowJoinRainChange && "join_rain" in cleanPatch) {
    delete cleanPatch.join_rain;
  }

  const next = { ...current, ...cleanPatch, updated_at: new Date().toISOString() };
  next.join_rain = Number(next.join_rain) !== 0 ? 1 : 0;
  next.pre_wager_before_rain = Number(next.pre_wager_before_rain) !== 0 ? 1 : 0;
  next.auto_vault_deposit = Number(next.auto_vault_deposit) !== 0 ? 1 : 0;
  next.vault_session_auto_deposit = Number(next.vault_session_auto_deposit) !== 0 ? 1 : 0;
  next.vault_lock_minutes = Math.max(0, Math.trunc(Number(next.vault_lock_minutes) || 0));
  next.automation_paused = Number(next.automation_paused) !== 0 ? 1 : 0;
  next.limbo_multiplier = clampLimboMultiplier(next.limbo_multiplier);
  next.limbo_bet_coins = clampLimboBetCoins(next.limbo_bet_coins);
  next.mines_count = Math.min(24, Math.max(1, Math.trunc(Number(next.mines_count) || 3)));
  next.mines_target_multiplier = Math.max(1.01, Number(next.mines_target_multiplier) || 2);
  next.mines_auto_enabled = Number(next.mines_auto_enabled) !== 0 ? 1 : 0;
  next.mines_random_tiles = Number(next.mines_random_tiles) !== 0 ? 1 : 0;
  next.mines_auto_rains_remaining = Math.trunc(Number(next.mines_auto_rains_remaining) || 0);
  next.mines_wallet_mode =
    String(next.mines_wallet_mode ?? "coin").toLowerCase() === "funcoin" ? "funCoin" : "coin";
  getDb()
    .prepare(
      `UPDATE accounts SET nickname = ?, owner_discord_id = ?, username = ?, password_enc = ?, session_jwt_enc = ?, api_key_enc = ?,
       proxy_url = ?, join_rain = ?, min_rain_amount = ?, auto_open_cases = ?, auto_redeem_codes = ?,
       min_code_level = ?, limbo_wager_enabled = ?, limbo_multiplier = ?, limbo_bet_coins = ?,
       mines_auto_enabled = ?, mines_count = ?, mines_target_multiplier = ?, mines_random_tiles = ?, mines_auto_rains_remaining = ?, mines_wallet_mode = ?,
       pre_wager_before_rain = ?, auto_vault_deposit = ?, vault_lock_minutes = ?, vault_lock_expires_at = ?,
       vault_session_auto_deposit = ?,
       automation_paused = ?,
       status = ?, last_error = ?, balance = ?, vault_balance = ?, level = ?,
       lifetime_rain = ?, lifetime_cases = ?, lifetime_codes = ?, updated_at = ?
       WHERE id = ?`,
    )
    .run(
      next.nickname,
      next.owner_discord_id,
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
      next.mines_auto_enabled ?? 0,
      next.mines_count ?? 3,
      next.mines_target_multiplier ?? 2,
      next.mines_random_tiles ?? 1,
      next.mines_auto_rains_remaining ?? 0,
      next.mines_wallet_mode ?? "coin",
      next.pre_wager_before_rain ?? 0,
      next.auto_vault_deposit ?? 0,
      next.vault_lock_minutes ?? 0,
      next.vault_lock_expires_at ?? null,
      next.vault_session_auto_deposit ?? 0,
      next.automation_paused ?? 0,
      next.status,
      next.last_error,
      next.balance,
      next.vault_balance ?? null,
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
  /** Bypass dedupe for rare one-off diagnostics. */
  force?: boolean;
}): void {
  if (!input.force && shouldSkipDuplicateActivityLog(input)) return;
  insertActivityLogRow(input);
}

function insertActivityLogRow(input: {
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

export function hasSuccessfulRainJoin(accountId: number, rainId: string): boolean {
  const row = getDb()
    .prepare(
      "SELECT 1 FROM rain_joins WHERE account_id = ? AND rain_id = ? AND success = 1 LIMIT 1",
    )
    .get(accountId, rainId) as { 1: number } | undefined;
  return row != null;
}

export function accountIdsWithSuccessfulRainJoin(rainId: string): number[] {
  const rows = getDb()
    .prepare("SELECT DISTINCT account_id FROM rain_joins WHERE rain_id = ? AND success = 1")
    .all(rainId) as Array<{ account_id: number }>;
  return rows.map((r) => r.account_id);
}

export function recordRainJoin(input: {
  accountId: number;
  rainId: string;
  amount: number | null;
  success: boolean;
  reason: string | null;
  balanceBeforeCoins?: number | null;
}): void {
  getDb()
    .prepare(
      "INSERT INTO rain_joins (account_id, rain_id, amount, success, reason, balance_before_coins, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)",
    )
    .run(
      input.accountId,
      input.rainId,
      input.amount,
      input.success ? 1 : 0,
      input.reason,
      input.balanceBeforeCoins ?? null,
      new Date().toISOString(),
    );
}

/** Balance right after a successful join — used for post-rain limbo (survives dev restarts). */
export function getRainJoinBalanceBefore(accountId: number, rainId: string): number | null {
  const row = getDb()
    .prepare(
      `SELECT balance_before_coins AS bal FROM rain_joins
       WHERE account_id = ? AND rain_id = ? AND success = 1 AND balance_before_coins IS NOT NULL
       ORDER BY id DESC LIMIT 1`,
    )
    .get(accountId, rainId) as { bal: number } | undefined;
  return row?.bal ?? null;
}

export function patchRainJoinBalanceBefore(
  accountId: number,
  rainId: string,
  balanceBeforeCoins: number,
): void {
  getDb()
    .prepare(
      `UPDATE rain_joins SET balance_before_coins = ?
       WHERE id = (
         SELECT id FROM rain_joins
         WHERE account_id = ? AND rain_id = ? AND success = 1
         ORDER BY id DESC LIMIT 1
       )`,
    )
    .run(balanceBeforeCoins, accountId, rainId);
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

export function getPilotStats(): {
  rainJoins7d: number;
  rainJoinsOk7d: number;
  rainJoinsFail7d: number;
  avgCaptchaSec7d: number | null;
  lifetimeRainCoins: number;
  lastRainJoinAt: string | null;
  estimatedCaptchaSpendUsd7d: number;
  captchaSolvesEstimate7d: number;
} {
  const db = getDb();
  const week = db
    .prepare(
      `SELECT
         COUNT(*) AS total,
         SUM(CASE WHEN success = 1 THEN 1 ELSE 0 END) AS ok,
         SUM(CASE WHEN success = 0 THEN 1 ELSE 0 END) AS fail,
         MAX(created_at) AS last_at
       FROM rain_joins
       WHERE created_at >= datetime('now', '-7 days')`,
    )
    .get() as { total: number; ok: number | null; fail: number | null; last_at: string | null };

  const captchaRows = db
    .prepare(
      `SELECT detail FROM activity_log
       WHERE message = 'Rain captcha ready' AND created_at >= datetime('now', '-7 days')
       ORDER BY id DESC LIMIT 40`,
    )
    .all() as Array<{ detail: string | null }>;

  const captchaSecs: number[] = [];
  for (const row of captchaRows) {
    const m = row.detail?.match(/·\s*([\d.]+)s\s*$/);
    if (m) captchaSecs.push(parseFloat(m[1]!));
  }
  const avgCaptchaSec7d =
    captchaSecs.length > 0
      ? captchaSecs.reduce((a, b) => a + b, 0) / captchaSecs.length
      : null;

  const lifetime = db
    .prepare("SELECT COALESCE(SUM(lifetime_rain), 0) AS n FROM accounts")
    .get() as { n: number };

  const solveEstimate = (week.total ?? 0) + Math.round((week.fail ?? 0) * 0.5);
  const spendPerSolve = Number(process.env.CAPTCHA_ESTIMATE_USD ?? 0.00299) || 0.00299;

  return {
    rainJoins7d: week.total ?? 0,
    rainJoinsOk7d: week.ok ?? 0,
    rainJoinsFail7d: week.fail ?? 0,
    avgCaptchaSec7d,
    lifetimeRainCoins: lifetime.n ?? 0,
    lastRainJoinAt: week.last_at,
    captchaSolvesEstimate7d: solveEstimate,
    estimatedCaptchaSpendUsd7d: Math.round(solveEstimate * spendPerSolve * 100) / 100,
  };
}

/** Successful rain joins since UTC midnight for the given accounts. */
export function countRainJoinsToday(accountIds: number[]): number {
  if (accountIds.length === 0) return 0;
  const dayStart = `${new Date().toISOString().slice(0, 10)}T00:00:00.000Z`;
  const placeholders = accountIds.map(() => "?").join(", ");
  const row = getDb()
    .prepare(
      `SELECT COUNT(*) AS n FROM rain_joins
       WHERE account_id IN (${placeholders}) AND success = 1 AND created_at >= ?`,
    )
    .get(...accountIds, dayStart) as { n: number };
  return row.n ?? 0;
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
