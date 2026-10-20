export type Account = {
  id: number;
  nickname: string;
  ownerDiscordId: string | null;
  username: string | null;
  hasPassword: boolean;
  hasSession: boolean;
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
  status: string;
  lastError: string | null;
  balance: number | null;
  level: number | null;
  lifetimeEarnings: { rain: number; cases: number; codes: number; total: number };
};

export type LicenseStatus = {
  active: boolean;
  devSkip: boolean;
  plan: string | null;
  licenseId: string | null;
  expiresAt: string | null;
  message: string | null;
};

export type Settings = {
  globalPause: boolean;
  discordEnabled: boolean;
  discordChannelId: string | null;
  hasDiscordToken: boolean;
  discordReportEnabled: boolean;
  hasDiscordReportWebhook: boolean;
  discordActivityFeedEnabled: boolean;
  captchaConfigured?: boolean;
  /** @deprecated use captchaConfigured */
  capmonsterConfigured?: boolean;
};

export type ActivityLog = {
  id: number;
  account_id: number | null;
  category: string;
  message: string;
  detail: string | null;
  created_at: string;
};

export type PilotStats = {
  rainJoins7d: number;
  rainJoinsOk7d: number;
  rainJoinsFail7d: number;
  avgCaptchaSec7d: number | null;
  lifetimeRainCoins: number;
  lastRainJoinAt: string | null;
  estimatedCaptchaSpendUsd7d: number;
  captchaSolvesEstimate7d: number;
};

export type RainAccountStatus = {
  accountId: number;
  nickname: string;
  phase: "idle" | "solving" | "ready" | "joining" | "joined" | "failed" | "skipped";
  detail?: string;
};

export type CaptchaBalanceStatus = {
  configured: boolean;
  provider: string | null;
  balanceUsd: number | null;
  lowBalance: boolean;
  lowBalanceThresholdUsd: number;
  checkedAtMs: number | null;
  error: string | null;
};

export type PilotBackupFile = {
  formatVersion: number;
  exportedAt: string;
  readme: string;
  accounts: unknown[];
  settings: Record<string, unknown>;
  envStillRequired: string[];
};

export type RainLiveStatus = {
  active: boolean;
  rainId: string | null;
  poolCoins: number | null;
  joinWindowOpen: boolean;
  joinOpensInSec: number;
  joinWindowRemainingSec: number;
  joinWindowTotalSec: number;
  captchaReady: boolean;
  captchaSolveSec: number | null;
  captchaWaitingSec: number | null;
  joinAttempts: number;
  joinedNicknames: string[];
  accountStatuses: RainAccountStatus[];
  listenerConnected: boolean;
  telemetry: unknown;
  lastSummary: string | null;
};

function clientApiUrl(path: string): string {
  // Browser: always same-origin (Next on 43123 → rewrite to automation API).
  // Direct :43124 often fails from Windows → WSL; curl in Ubuntu still uses the API process.
  if (typeof window !== "undefined") return path;
  const base = (process.env.NEXT_PUBLIC_AUTOMATION_API_URL ?? "").replace(/\/$/, "");
  return base ? `${base}${path}` : path;
}

async function api<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(clientApiUrl(path), {
    ...init,
    headers: { "Content-Type": "application/json", ...(init?.headers ?? {}) },
    cache: "no-store",
    signal: init?.signal ?? AbortSignal.timeout(12_000),
  });
  if (!res.ok) {
    const body = (await res.json().catch(() => ({}))) as { error?: string };
    throw new Error(body.error ?? `Request failed (${res.status})`);
  }
  if (res.status === 204) return undefined as T;
  return res.json() as Promise<T>;
}

export const dashboardApi = {
  getLicenseStatus: () => api<LicenseStatus>("/api/license/status"),
  activateLicense: (key: string) =>
    api<LicenseStatus>("/api/license/activate", { method: "POST", body: JSON.stringify({ key }) }),
  getSettings: () => api<Settings>("/api/settings"),
  patchSettings: (
    body: Partial<
      Settings & {
        discordToken?: string | null;
        discordReportWebhook?: string | null;
        discordActivityFeedEnabled?: boolean;
      }
    >,
  ) => api<Settings>("/api/settings", { method: "PATCH", body: JSON.stringify(body) }),
  testDiscordReport: () => api<{ ok: true }>("/api/discord/test-report", { method: "POST" }),
  getDiscordRelayStatus: () =>
    api<{ relayConfigured: boolean; connected: boolean }>("/api/discord/relay-status"),
  listAccounts: () => api<Account[]>("/api/rush-accounts"),
  refreshAccountStats: () =>
    api<{ ok: true; accounts: Account[] }>("/api/rush-accounts/refresh-stats", { method: "POST" }),
  createAccount: (body: Record<string, unknown>) =>
    api<Account>("/api/rush-accounts", { method: "POST", body: JSON.stringify(body) }),
  patchAccount: (id: number, body: Record<string, unknown>) =>
    api<Account>(`/api/rush-accounts/${id}`, { method: "PATCH", body: JSON.stringify(body) }),
  deleteAccount: (id: number) => api<{ ok: true; id: number }>(`/api/rush-accounts/${id}`, { method: "DELETE" }),
  testLimbo: (id: number, body: { betCoins: number; multiplier?: number }) =>
    api<{ ok: true; betCoins: number; hit: boolean }>(`/api/rush-accounts/${id}/test-limbo`, {
      method: "POST",
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(60_000),
    }),
  listLogs: () => api<ActivityLog[]>("/api/logs"),
  getStatsSummary: () => api<PilotStats>("/api/stats/summary"),
  getRainLive: () => api<RainLiveStatus>("/api/rain/live"),
  getCaptchaStatus: () => api<CaptchaBalanceStatus>("/api/captcha/status"),
  exportBackup: () => api<PilotBackupFile>("/api/backup/export"),
  importBackup: (file: PilotBackupFile) =>
    api<{ ok: true; importedAccounts: number; skippedDuplicates: number }>("/api/backup/import", {
      method: "POST",
      body: JSON.stringify(file),
    }),
};
