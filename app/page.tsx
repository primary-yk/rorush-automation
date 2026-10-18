"use client";

import { useCallback, useEffect, useState } from "react";
import { Toggle } from "@/components/Toggle";
import { dashboardApi, type Account, type ActivityLog, type Settings } from "@/lib/api";

export default function DashboardPage() {
  const [settings, setSettings] = useState<Settings | null>(null);
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [logs, setLogs] = useState<ActivityLog[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const [newNick, setNewNick] = useState("");
  const [newUser, setNewUser] = useState("");
  const [newPass, setNewPass] = useState("");
  const [newSession, setNewSession] = useState("");
  const [discordChannel, setDiscordChannel] = useState("");
  const [discordToken, setDiscordToken] = useState("");

  const refresh = useCallback(async () => {
    try {
      const [s, a, l] = await Promise.all([
        dashboardApi.getSettings(),
        dashboardApi.listAccounts(),
        dashboardApi.listLogs(),
      ]);
      setSettings(s);
      setAccounts(a);
      setLogs(l);
      setDiscordChannel(s.discordChannelId ?? "");
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void refresh();
    const t = setInterval(() => void refresh(), 15_000);
    return () => clearInterval(t);
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

  if (loading) {
    return (
      <main className="mx-auto flex min-h-screen max-w-6xl items-center justify-center p-6">
        <p className="text-muted">Loading dashboard…</p>
      </main>
    );
  }

  return (
    <main className="mx-auto min-h-screen max-w-6xl space-y-8 p-6">
      <header className="flex flex-wrap items-end justify-between gap-4 border-b border-border pb-6">
        <div>
          <p className="text-sm uppercase tracking-wide text-muted">Self-hosted module</p>
          <h1 className="text-3xl font-semibold">RoRush Automation</h1>
          <p className="mt-1 max-w-2xl text-sm text-muted">
            Rain joiner, rank/daily cases, optional Discord code watcher. Credentials are encrypted at rest;
            secrets never appear in logs.
          </p>
        </div>
        {settings && (
          <Toggle
            label={settings.globalPause ? "Global pause (on)" : "Global pause (off)"}
            checked={settings.globalPause}
            onChange={async (v) => {
              const s = await dashboardApi.patchSettings({ globalPause: v });
              setSettings(s);
            }}
          />
        )}
      </header>

      {error && (
        <div className="rounded-lg border border-danger/40 bg-danger/10 px-4 py-3 text-sm text-danger">
          {error} — is the automation API running? (<code className="text-xs">npm run dev</code>)
        </div>
      )}

      <section className="grid gap-6 lg:grid-cols-2">
        <div className="rounded-xl border border-border bg-panel p-5">
          <h2 className="text-lg font-medium">Add account</h2>
          <p className="mt-1 text-sm text-muted">Email + password, or paste a session JWT from the browser.</p>
          <div className="mt-4 grid gap-3">
            <input
              className="rounded-md border border-border bg-[#0b0d12] px-3 py-2 text-sm"
              placeholder="Nickname"
              value={newNick}
              onChange={(e) => setNewNick(e.target.value)}
            />
            <input
              className="rounded-md border border-border bg-[#0b0d12] px-3 py-2 text-sm"
              placeholder="Login email (optional)"
              value={newUser}
              onChange={(e) => setNewUser(e.target.value)}
            />
            <input
              type="password"
              className="rounded-md border border-border bg-[#0b0d12] px-3 py-2 text-sm"
              placeholder="Password (optional)"
              value={newPass}
              onChange={(e) => setNewPass(e.target.value)}
            />
            <input
              className="rounded-md border border-border bg-[#0b0d12] px-3 py-2 text-sm"
              placeholder="Session JWT (optional)"
              value={newSession}
              onChange={(e) => setNewSession(e.target.value)}
            />
            <button
              type="button"
              onClick={() => void createAccount()}
              className="rounded-md bg-accent/20 px-4 py-2 text-sm font-medium text-accent hover:bg-accent/30"
            >
              Save account
            </button>
          </div>
        </div>

        <div className="rounded-xl border border-border bg-panel p-5">
          <h2 className="text-lg font-medium">Discord code watcher</h2>
          <p className="mt-1 text-sm text-muted">Read-only channel polling with your user token (stored encrypted).</p>
          <div className="mt-4 grid gap-3">
            {settings && (
              <Toggle
                label="Watch channel"
                checked={settings.discordEnabled}
                onChange={async (v) => {
                  const s = await dashboardApi.patchSettings({ discordEnabled: v });
                  setSettings(s);
                }}
              />
            )}
            <input
              className="rounded-md border border-border bg-[#0b0d12] px-3 py-2 text-sm"
              placeholder="Channel ID"
              value={discordChannel}
              onChange={(e) => setDiscordChannel(e.target.value)}
            />
            <input
              type="password"
              className="rounded-md border border-border bg-[#0b0d12] px-3 py-2 text-sm"
              placeholder={settings?.hasDiscordToken ? "Discord token (leave blank to keep)" : "Discord user token"}
              value={discordToken}
              onChange={(e) => setDiscordToken(e.target.value)}
            />
            <button
              type="button"
              className="rounded-md border border-border px-4 py-2 text-sm hover:bg-white/5"
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
            </button>
          </div>
        </div>
      </section>

      <section className="space-y-4">
        <h2 className="text-lg font-medium">Accounts</h2>
        {accounts.length === 0 && (
          <p className="text-sm text-muted">No accounts yet. Add one above to start automation.</p>
        )}
        <div className="grid gap-4">
          {accounts.map((a) => (
            <AccountCard key={a.id} account={a} onChange={refresh} />
          ))}
        </div>
      </section>

      <section className="rounded-xl border border-border bg-panel p-5">
        <h2 className="text-lg font-medium">Activity log</h2>
        <ul className="mt-4 max-h-80 space-y-2 overflow-y-auto text-sm">
          {logs.map((log) => (
            <li key={log.id} className="border-b border-border/60 pb-2">
              <span className="text-muted">{new Date(log.created_at).toLocaleString()} · {log.category}</span>
              <div>{log.message}</div>
              {log.detail && <div className="text-muted">{log.detail}</div>}
            </li>
          ))}
        </ul>
      </section>
    </main>
  );
}

function AccountCard({ account, onChange }: { account: Account; onChange: () => Promise<void> }) {
  return (
    <article className="rounded-xl border border-border bg-panel p-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h3 className="text-xl font-medium">{account.nickname}</h3>
          <p className="text-sm text-muted">
            {account.username ?? "session auth"} · Level {account.level ?? "—"} · Balance{" "}
            {account.balance?.toFixed(2) ?? "—"}
          </p>
          <p className="mt-1 text-xs text-muted">
            Lifetime (rain + cases + codes): {account.lifetimeEarnings.total.toFixed(2)}
          </p>
        </div>
        <span
          className={
            account.status === "error"
              ? "rounded-full bg-danger/15 px-3 py-1 text-xs text-danger"
              : "rounded-full bg-accent/10 px-3 py-1 text-xs text-accent"
          }
        >
          {account.status}
        </span>
      </div>
      {account.lastError && (
        <p className="mt-2 text-sm text-danger">Last error: {account.lastError}</p>
      )}
      <div className="mt-4 flex flex-wrap gap-2">
        <Toggle
          label="Join rain"
          checked={account.joinRain}
          onChange={async (v) => {
            await dashboardApi.patchAccount(account.id, { joinRain: v });
            await onChange();
          }}
        />
        <Toggle
          label="Auto-open cases"
          checked={account.autoOpenCases}
          onChange={async (v) => {
            await dashboardApi.patchAccount(account.id, { autoOpenCases: v });
            await onChange();
          }}
        />
        <Toggle
          label="Redeem codes"
          checked={account.autoRedeemCodes}
          onChange={async (v) => {
            await dashboardApi.patchAccount(account.id, { autoRedeemCodes: v });
            await onChange();
          }}
        />
      </div>
      <div className="mt-4 grid gap-3 sm:grid-cols-2">
        <label className="text-sm">
          Min rain amount
          <input
            type="number"
            step="0.01"
            className="mt-1 w-full rounded-md border border-border bg-[#0b0d12] px-3 py-2"
            defaultValue={account.minRainAmount}
            onBlur={async (e) => {
              await dashboardApi.patchAccount(account.id, { minRainAmount: Number(e.target.value) });
              await onChange();
            }}
          />
        </label>
        <label className="text-sm">
          Min code level
          <input
            type="number"
            className="mt-1 w-full rounded-md border border-border bg-[#0b0d12] px-3 py-2"
            defaultValue={account.minCodeLevel}
            onBlur={async (e) => {
              await dashboardApi.patchAccount(account.id, { minCodeLevel: Number(e.target.value) });
              await onChange();
            }}
          />
        </label>
      </div>
      <button
        type="button"
        className="mt-4 text-sm text-danger hover:underline"
        onClick={async () => {
          if (!confirm(`Delete ${account.nickname}?`)) return;
          await dashboardApi.deleteAccount(account.id);
          await onChange();
        }}
      >
        Remove account
      </button>
    </article>
  );
}
