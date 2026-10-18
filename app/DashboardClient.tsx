"use client";

import { useCallback, useEffect, useState } from "react";
import { SetupGuide } from "@/components/SetupGuide";
import { Toggle } from "@/components/Toggle";
import { Button, Card, Input, SectionTitle, StatusPill } from "@/components/ui";
import { dashboardApi, type Account, type ActivityLog, type Settings } from "@/lib/api";

export type DashboardBootstrap = {
  settings: Settings | null;
  accounts: Account[];
  logs: ActivityLog[];
  error: string | null;
};

export function DashboardClient({ initial }: { initial: DashboardBootstrap }) {
  const [settings, setSettings] = useState<Settings | null>(initial.settings);
  const [accounts, setAccounts] = useState<Account[]>(initial.accounts);
  const [logs, setLogs] = useState<ActivityLog[]>(initial.logs);
  const [error, setError] = useState<string | null>(initial.error);
  const [loading, setLoading] = useState(initial.settings == null && initial.error == null);

  const [newNick, setNewNick] = useState("");
  const [newUser, setNewUser] = useState("");
  const [newPass, setNewPass] = useState("");
  const [newSession, setNewSession] = useState("");
  const [discordChannel, setDiscordChannel] = useState(initial.settings?.discordChannelId ?? "");
  const [discordToken, setDiscordToken] = useState("");

  const refresh = useCallback(async () => {
    try {
      const s = await dashboardApi.getSettings();
      setSettings(s);
      setDiscordChannel(s.discordChannelId ?? "");
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
    try {
      const [a, l] = await Promise.all([dashboardApi.listAccounts(), dashboardApi.listLogs()]);
      setAccounts(a);
      setLogs(l);
    } catch (e) {
      setError((prev) => prev ?? (e instanceof Error ? e.message : String(e)));
    }
  }, []);

  useEffect(() => {
    const force = window.setTimeout(() => setLoading(false), 5000);
    void refresh();
    const t = setInterval(() => void refresh(), 15_000);
    return () => {
      window.clearTimeout(force);
      clearInterval(t);
    };
  }, [refresh]);

  async function createAccount() {
    if (!newNick.trim()) return;
    await dashboardApi.createAccount({
      nickname: newNick.trim(),
      username: newUser || undefined,
      password: newPass || undefined,
      sessionToken: newSession || undefined,
    });
    setNewNick("");
    setNewUser("");
    setNewPass("");
    setNewSession("");
    await refresh();
  }

  const apiOk = !error && settings != null;

  if (loading) {
    return (
      <main className="flex min-h-screen max-w-lg flex-col items-center justify-center gap-4 px-6 text-center">
        <p className="animate-pulse-soft text-slate-400">Connecting to automation engine…</p>
        <p className="text-sm text-slate-500">Loading your dashboard — this should only take a few seconds.</p>
      </main>
    );
  }

  return (
    <main className="mx-auto min-h-screen max-w-5xl px-4 py-10 sm:px-6">
      <header className="mb-10 flex flex-col gap-6 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <div className="mb-3 inline-flex items-center gap-2 rounded-full border border-white/10 bg-white/5 px-3 py-1 text-xs text-slate-300">
            <span
              className={`h-2 w-2 rounded-full ${apiOk ? "bg-emerald-400 shadow-[0_0_8px_rgba(52,211,153,0.8)]" : "bg-rose-400"}`}
            />
            Engine {apiOk ? "online" : "offline"}
          </div>
          <h1 className="font-display text-4xl font-bold tracking-tight text-white sm:text-5xl">
            Rush <span className="bg-gradient-to-r from-violet-300 to-fuchsia-400 bg-clip-text text-transparent">Pilot</span>
          </h1>
          <p className="mt-3 max-w-xl text-base leading-relaxed text-slate-400">
            Your private control panel for RoRush rain joins, reward cases, and optional Discord codes. Runs on your PC
            or VPS — not on our servers.
          </p>
        </div>
        {settings && (
          <Toggle
            label="Global pause"
            description={settings.globalPause ? "Automation stopped" : "Automation active"}
            checked={settings.globalPause}
            onChange={async (v) => {
              const s = await dashboardApi.patchSettings({ globalPause: v });
              setSettings(s);
            }}
          />
        )}
      </header>

      <div className="space-y-8">
        <SetupGuide apiOk={apiOk} />

        {error && (
          <Card className="border-rose-500/30 bg-rose-500/5">
            <p className="text-sm font-medium text-rose-200">Can’t reach the automation engine</p>
            <p className="mt-2 text-sm text-slate-400">
              Open a terminal in your project folder and run{" "}
              <code className="font-mono rounded bg-black/40 px-1.5 py-0.5 text-rose-100">npm run dev</code>. Keep
              that window open, then refresh this page.
            </p>
            <p className="mt-2 font-mono text-xs text-slate-500">{error}</p>
          </Card>
        )}

        <div className="grid gap-6 lg:grid-cols-2">
          <Card glow="mint">
            <SectionTitle
              eyebrow="Step 4"
              title="RoRush account"
              description="Pick a nickname you’ll recognize. Use the same email and password as on rorush.com, or paste a session token if you use 2FA."
            />
            <div className="grid gap-3">
              <Input placeholder="Nickname — e.g. Main" value={newNick} onChange={(e) => setNewNick(e.target.value)} />
              <Input
                placeholder="RoRush login email"
                value={newUser}
                onChange={(e) => setNewUser(e.target.value)}
                autoComplete="off"
              />
              <Input
                type="password"
                placeholder="RoRush password"
                value={newPass}
                onChange={(e) => setNewPass(e.target.value)}
                autoComplete="new-password"
              />
              <details className="text-sm text-slate-500">
                <summary className="cursor-pointer text-violet-300/90">Advanced: session JWT instead of password</summary>
                <Input
                  className="mt-2"
                  placeholder="Paste JWT from browser DevTools (after login)"
                  value={newSession}
                  onChange={(e) => setNewSession(e.target.value)}
                />
              </details>
              <Button onClick={() => void createAccount()}>Save account</Button>
            </div>
          </Card>

          <Card>
            <SectionTitle
              eyebrow="Optional"
              title="Discord code watcher"
              description="Watches one channel for promo codes and redeems on accounts that have “Redeem codes” enabled. Token is stored encrypted."
            />
            <div className="grid gap-3">
              {settings && (
                <Toggle
                  label="Watch channel"
                  description="Poll for new codes"
                  checked={settings.discordEnabled}
                  onChange={async (v) => {
                    const s = await dashboardApi.patchSettings({ discordEnabled: v });
                    setSettings(s);
                  }}
                />
              )}
              <Input
                placeholder="Discord channel ID"
                value={discordChannel}
                onChange={(e) => setDiscordChannel(e.target.value)}
              />
              <Input
                type="password"
                placeholder={settings?.hasDiscordToken ? "New token (leave blank to keep)" : "Discord user token"}
                value={discordToken}
                onChange={(e) => setDiscordToken(e.target.value)}
              />
              <Button
                variant="ghost"
                onClick={async () => {
                  const s = await dashboardApi.patchSettings({
                    discordChannelId: discordChannel || null,
                    discordToken: discordToken || null,
                  });
                  setSettings(s);
                  setDiscordToken("");
                }}
              >
                Save Discord settings
              </Button>
            </div>
          </Card>
        </div>

        <section>
          <SectionTitle
            eyebrow="Accounts"
            title="Who’s running"
            description="Each card is one RoRush login. Toggles control rain, cases, and code redeems independently."
          />
          {accounts.length === 0 ? (
            <Card className="mt-4 border-dashed border-white/10 text-center text-slate-500">
              No accounts yet — add one above to start.
            </Card>
          ) : (
            <div className="mt-4 grid gap-4">
              {accounts.map((a) => (
                <AccountCard key={a.id} account={a} onChange={refresh} />
              ))}
            </div>
          )}
        </section>

        <Card>
          <SectionTitle
            eyebrow="Live"
            title="Activity log"
            description="Rain attempts, case opens, and errors. Passwords and tokens never appear here."
          />
          <ul className="mt-2 max-h-72 space-y-3 overflow-y-auto text-sm">
            {logs.length === 0 && <li className="text-slate-500">No activity yet.</li>}
            {logs.map((log) => (
              <li key={log.id} className="rounded-lg border border-white/5 bg-black/20 px-3 py-2">
                <div className="flex flex-wrap items-center gap-2 text-xs text-slate-500">
                  <span>{new Date(log.created_at).toLocaleString()}</span>
                  <span className="rounded bg-white/5 px-1.5 py-0.5 uppercase tracking-wide">{log.category}</span>
                </div>
                <p className="mt-1 text-slate-200">{log.message}</p>
                {log.detail && <p className="mt-0.5 text-slate-500">{log.detail}</p>}
              </li>
            ))}
          </ul>
        </Card>
      </div>

      <footer className="mt-12 border-t border-white/5 pt-6 text-center text-xs text-slate-600">
        Self-hosted · Unaffiliated with RoRush · Use at your own risk
      </footer>
    </main>
  );
}

function AccountCard({ account, onChange }: { account: Account; onChange: () => Promise<void> }) {
  const ok = account.status !== "error";
  return (
    <Card className="border-white/[0.06]">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h3 className="text-xl font-semibold text-white">{account.nickname}</h3>
          <p className="mt-1 text-sm text-slate-400">
            {account.username ?? "Session login"} · Level {account.level ?? "—"} · Balance{" "}
            {account.balance != null ? account.balance.toFixed(2) : "—"}
          </p>
          <p className="mt-2 text-xs text-slate-500">
            Lifetime free earnings (rain + cases + codes):{" "}
            <span className="font-medium text-emerald-300/90">{account.lifetimeEarnings.total.toFixed(2)}</span>
          </p>
        </div>
        <StatusPill ok={ok} label={account.status} />
      </div>
      {account.lastError && (
        <p className="mt-3 rounded-lg bg-rose-500/10 px-3 py-2 text-sm text-rose-200">{account.lastError}</p>
      )}
      <div className="mt-5 grid gap-2 sm:grid-cols-3">
        <Toggle
          label="Join rain"
          description="Auto-join chat rains"
          checked={account.joinRain}
          onChange={async (v) => {
            await dashboardApi.patchAccount(account.id, { joinRain: v });
            await onChange();
          }}
        />
        <Toggle
          label="Auto-open cases"
          description="Daily / rank / energy"
          checked={account.autoOpenCases}
          onChange={async (v) => {
            await dashboardApi.patchAccount(account.id, { autoOpenCases: v });
            await onChange();
          }}
        />
        <Toggle
          label="Redeem codes"
          description="Discord promos"
          checked={account.autoRedeemCodes}
          onChange={async (v) => {
            await dashboardApi.patchAccount(account.id, { autoRedeemCodes: v });
            await onChange();
          }}
        />
      </div>
      <div className="mt-4 grid gap-3 sm:grid-cols-2">
        <label className="text-sm text-slate-400">
          Min rain amount (coins)
          <Input
            type="number"
            step="0.01"
            className="mt-1"
            defaultValue={account.minRainAmount}
            onBlur={async (e) => {
              await dashboardApi.patchAccount(account.id, { minRainAmount: Number(e.target.value) });
              await onChange();
            }}
          />
        </label>
        <label className="text-sm text-slate-400">
          Min level for codes
          <Input
            type="number"
            className="mt-1"
            defaultValue={account.minCodeLevel}
            onBlur={async (e) => {
              await dashboardApi.patchAccount(account.id, { minCodeLevel: Number(e.target.value) });
              await onChange();
            }}
          />
        </label>
      </div>
      <Button
        variant="danger"
        className="mt-4 text-sm"
        onClick={async () => {
          if (!confirm(`Remove ${account.nickname}?`)) return;
          await dashboardApi.deleteAccount(account.id);
          await onChange();
        }}
      >
        Remove account
      </Button>
    </Card>
  );
}
