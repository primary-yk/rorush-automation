import {
  getSettings,
  insertAccount,
  listAccounts,
  updateAccount,
  updateSettings,
} from "../db/repositories.js";

export const BACKUP_FORMAT_VERSION = 1;

/** Portable snapshot — passwords/sessions stay encrypted; needs the same ENCRYPTION_KEY in .env to use on a new PC/VPS. */
export type PilotBackupFile = {
  formatVersion: typeof BACKUP_FORMAT_VERSION;
  exportedAt: string;
  readme: string;
  accounts: Array<{
    nickname: string;
    ownerDiscordId: string | null;
    username: string | null;
    passwordEnc: string | null;
    sessionJwtEnc: string | null;
    apiKeyEnc: string | null;
    proxyUrl: string | null;
    joinRain: boolean;
    minRainAmount: number;
    autoOpenCases: boolean;
    autoRedeemCodes: boolean;
    minCodeLevel: number;
    limboWagerEnabled: boolean;
    limboMultiplier: number;
    limboBetCoins: number;
    preWagerBeforeRain: boolean;
  }>;
  settings: {
    globalPause: boolean;
    discordEnabled: boolean;
    discordChannelId: string | null;
    discordReportEnabled: boolean;
    discordActivityFeedEnabled: boolean;
  };
  envStillRequired: string[];
};

export function buildPilotBackup(): PilotBackupFile {
  const settings = getSettings();
  const accounts = listAccounts();
  return {
    formatVersion: BACKUP_FORMAT_VERSION,
    exportedAt: new Date().toISOString(),
    readme:
      "Rush Pilot backup. Encrypted login blobs only decrypt with the SAME ENCRYPTION_KEY from your .env. " +
      "You must still copy CAPTCHA_API_KEY and Discord secrets manually (or re-enter in Settings). " +
      "Safe to store offline; do not share publicly.",
    accounts: accounts.map((a) => ({
      nickname: a.nickname,
      ownerDiscordId: a.owner_discord_id,
      username: a.username,
      passwordEnc: a.password_enc,
      sessionJwtEnc: a.session_jwt_enc,
      apiKeyEnc: a.api_key_enc,
      proxyUrl: a.proxy_url,
      joinRain: !!a.join_rain,
      minRainAmount: a.min_rain_amount,
      autoOpenCases: !!a.auto_open_cases,
      autoRedeemCodes: !!a.auto_redeem_codes,
      minCodeLevel: a.min_code_level,
      limboWagerEnabled: !!a.limbo_wager_enabled,
      limboMultiplier: a.limbo_multiplier,
      limboBetCoins: a.limbo_bet_coins,
      preWagerBeforeRain: !!a.pre_wager_before_rain,
    })),
    settings: {
      globalPause: !!settings.global_pause,
      discordEnabled: !!settings.discord_enabled,
      discordChannelId: settings.discord_channel_id,
      discordReportEnabled: !!settings.discord_report_enabled,
      discordActivityFeedEnabled: !!settings.discord_activity_feed_enabled,
    },
    envStillRequired: [
      "ENCRYPTION_KEY (must match the machine that created this backup)",
      "CAPTCHA_API_KEY + CAPTCHA_PROVIDER",
      "Optional: DISCORD_BOT_RELAY_URL, RORUSH_PROXY_URL",
    ],
  };
}

export type ImportPilotBackupResult = {
  importedAccounts: number;
  skippedDuplicates: number;
};

export function importPilotBackup(file: PilotBackupFile): ImportPilotBackupResult {
  if (file.formatVersion !== BACKUP_FORMAT_VERSION) {
    throw new Error(`Unsupported backup version ${file.formatVersion}`);
  }
  const existing = new Set(listAccounts().map((a) => a.nickname.toLowerCase()));
  let imported = 0;
  let skipped = 0;
  for (const row of file.accounts) {
    if (existing.has(row.nickname.toLowerCase())) {
      skipped++;
      continue;
    }
    const created = insertAccount({
      nickname: row.nickname,
      owner_discord_id: row.ownerDiscordId,
      username: row.username,
      password_enc: row.passwordEnc,
      session_jwt_enc: row.sessionJwtEnc,
      api_key_enc: row.apiKeyEnc,
      proxy_url: row.proxyUrl,
    });
    updateAccount(
      created.id,
      {
        join_rain: row.joinRain ? 1 : 0,
        min_rain_amount: row.minRainAmount,
        auto_open_cases: row.autoOpenCases ? 1 : 0,
        auto_redeem_codes: row.autoRedeemCodes ? 1 : 0,
        min_code_level: row.minCodeLevel,
        limbo_wager_enabled: row.limboWagerEnabled ? 1 : 0,
        limbo_multiplier: row.limboMultiplier,
        limbo_bet_coins: row.limboBetCoins,
        pre_wager_before_rain: row.preWagerBeforeRain ? 1 : 0,
      },
      { allowJoinRainChange: true },
    );
    existing.add(row.nickname.toLowerCase());
    imported += 1;
  }
  updateSettings({
    global_pause: file.settings.globalPause ? 1 : 0,
    discord_enabled: file.settings.discordEnabled ? 1 : 0,
    discord_channel_id: file.settings.discordChannelId,
    discord_report_enabled: file.settings.discordReportEnabled ? 1 : 0,
    discord_activity_feed_enabled: file.settings.discordActivityFeedEnabled ? 1 : 0,
  });

  return { importedAccounts: imported, skippedDuplicates: skipped };
}
