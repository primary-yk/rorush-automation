export type Account = {
  id: number;
  nickname: string;
  username: string | null;
  hasPassword: boolean;
  hasSession: boolean;
  proxyUrl: string | null;
  joinRain: boolean;
  minRainAmount: number;
  autoOpenCases: boolean;
  autoRedeemCodes: boolean;
  minCodeLevel: number;
  status: string;
  lastError: string | null;
  balance: number | null;
  level: number | null;
  lifetimeEarnings: { rain: number; cases: number; codes: number; total: number };
};

export type Settings = {
  globalPause: boolean;
  discordEnabled: boolean;
  discordChannelId: string | null;
  hasDiscordToken: boolean;
};

export type ActivityLog = {
  id: number;
  account_id: number | null;
  category: string;
  message: string;
  detail: string | null;
  created_at: string;
};

async function api<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(path, {
    ...init,
    headers: { "Content-Type": "application/json", ...(init?.headers ?? {}) },
    cache: "no-store",
  });
  if (!res.ok) {
    const body = (await res.json().catch(() => ({}))) as { error?: string };
    throw new Error(body.error ?? `Request failed (${res.status})`);
  }
  if (res.status === 204) return undefined as T;
  return res.json() as Promise<T>;
}

export const dashboardApi = {
  getSettings: () => api<Settings>("/api/settings"),
  patchSettings: (body: Partial<Settings & { discordToken?: string | null }>) =>
    api<Settings>("/api/settings", { method: "PATCH", body: JSON.stringify(body) }),
  listAccounts: () => api<Account[]>("/api/accounts"),
  createAccount: (body: Record<string, unknown>) =>
    api<Account>("/api/accounts", { method: "POST", body: JSON.stringify(body) }),
  patchAccount: (id: number, body: Record<string, unknown>) =>
    api<Account>(`/api/accounts/${id}`, { method: "PATCH", body: JSON.stringify(body) }),
  deleteAccount: (id: number) => api<void>(`/api/accounts/${id}`, { method: "DELETE" }),
  listLogs: () => api<ActivityLog[]>("/api/logs"),
};
