"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { AccountCard } from "@/components/AccountCard";
import { ActivityFeed } from "@/components/ActivityFeed";
import { AppShell, type DashboardTab } from "@/components/AppShell";
import { SetupGuide } from "@/components/SetupGuide";
import { Toggle } from "@/components/Toggle";
import { Button, Card, Input, MetricCard, SectionTitle } from "@/components/ui";
import { useToast } from "@/components/Toast";
import { IconBolt, IconBox, IconRain } from "@/components/icons";
import { dashboardApi, type Account, type ActivityLog, type Settings } from "@/lib/api";

export type DashboardBootstrap = {
  settings: Settings | null;
  accounts: Account[];
  logs: ActivityLog[];
  error: string | null;
};

export function DashboardClient({ initial }: { initial: DashboardBootstrap }) {
  const toast = useToast();
  const [tab, setTab] = useState<DashboardTab>("overview");
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
  const [discordReportWebhook, setDiscordReportWebhook] = useState("");
  const [savingAccount, setSavingAccount] = useState(false);

  const apiOk = !error && settings != null;

  const totalEarnings = accounts.reduce((n, a) => n + a.lifetimeEarnings.total, 0);
  const rainEnabled = accounts.filter((a) => a.joinRain).length;
  const casesEnabled = accounts.filter((a) => a.autoOpenCases).length;

  const accountsById = useMemo(() => new Map(accounts.map((a) => [a.id, a.nickname])), [accounts]);

  const mergeAccount = useCallback((updated: Account) => {
    setAccounts((prev) => prev.map((a) => (a.id === updated.id ? updated : a)));
  }, []);

  const removeAccountById = useCallback((id: number) => {
    setAccounts((prev) => prev.filter((a) => a.id !== id));
  }, []);

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
    if (!newNick.trim()) {
      toast.push("Pick a nickname first.", "error");
      return;
    }
    if (!newSession.trim() && (!newUser.trim() || !newPass)) {
      toast.push("Add email + password, or paste a session token.", "error");
      return;
    }
    setSavingAccount(true);
    try {
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
      toast.push("Account saved.", "success");
      setTab("accounts");
      await refresh();
    } catch (e) {
      toast.push(e instanceof Error ? e.message : "Could not save account", "error");
    } finally {
      setSavingAccount(false);
    }
  }

  const [pausePending, setPausePending] = useState(false);
  const pauseToggle =
    settings != null ? (
      <Toggle
        label="Global pause"
        description={settings.globalPause ? "All automation stopped" : "Automation running"}
        checked={settings.globalPause}
        pending={pausePending}
        compact
        onChange={(v) => {
          const prev = settings.globalPause;
          setSettings({ ...settings, globalPause: v });
          setPausePending(true);
          void dashboardApi
            .patchSettings({ globalPause: v })
            .then((s) => {
              setSettings(s);
              toast.push(v ? "Automation paused" : "Automation resumed", "info");
            })
            .catch((e) => {
              setSettings({ ...settings, globalPause: prev });
              toast.push(e instanceof Error ? e.message : "Could not update pause", "error");
            })
            .finally(() => setPausePending(false));
        }}
      />
    ) : null;

  if (loading) {
    return (
      <main className="flex min-h-screen flex-col items-center justify-center gap-6 px-6 text-center">
        <div className="relative h-16 w-16">
          <div className="absolute inset-0 rounded-2xl border border-violet-500/30 bg-violet-500/10" />
          <div className="absolute inset-0 animate-spin-slow rounded-2xl border-2 border-transparent border-t-violet-400" />
        </div>
        <div>
          <p className="text-lg font-medium text-white">Connecting to engine</p>
          <p className="mt-2 max-w-sm text-sm text-slate-500">
            Starting Rush Pilot — if this hangs, run <code className="text-violet-300">npm run dev</code> in your project
            folder.
          </p>
        </div>
      </main>
    );
  }

  return (
    <AppShell tab={tab} onTab={setTab} engineOnline={apiOk} headerExtra={pauseToggle}>
      {error && (
        <Card className="mb-8 border-rose-500/30 bg-rose-500/[0.06]" glow="none">
          <p className="text-sm font-semibold text-rose-100">Can’t reach the automation engine</p>
          <p className="mt-2 text-sm leading-relaxed text-slate-400">
            In Ubuntu (WSL), open your project folder and run{" "}
            <code className="rounded-lg bg-black/40 px-2 py-0.5 font-mono text-xs text-rose-100">npm run dev</code>.
            Keep that terminal open, then refresh this page.
          </p>
          <p className="mt-3 font-mono text-xs text-slate-600">{error}</p>
        </Card>
      )}

      {tab === "overview" && (
        <div className="space-y-8">
          <div>
            <h1 className="font-display text-3xl font-bold tracking-tight text-white sm:text-4xl">
              Good to go{accounts.length ? `, ${accounts.length} pilot${accounts.length === 1 ? "" : "s"} active` : ""}
            </h1>
            <p className="mt-2 max-w-xl text-slate-400">
              Rain, reward cases, and Discord codes — running locally with encrypted credentials.
            </p>
          </div>

          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <MetricCard
              label="Lifetime earnings"
              value={totalEarnings.toFixed(2)}
              sub="Rain + cases + codes"
              trend="up"
              icon={<IconBolt className="h-5 w-5" />}
            />
            <MetricCard label="Accounts" value={String(accounts.length)} sub="RoRush logins" icon={<IconRain className="h-5 w-5" />} />
            <MetricCard
              label="Rain join"
              value={String(rainEnabled)}
              sub={`of ${accounts.length} enabled`}
              icon={<IconRain className="h-5 w-5" />}
            />
            <MetricCard
              label="Auto cases"
              value={String(casesEnabled)}
              sub="Daily / weekly / monthly"
              icon={<IconBox className="h-5 w-5" />}
            />
          </div>

          {!apiOk && <SetupGuide apiOk={apiOk} hasAccounts={accounts.length > 0} />}

          {accounts.length === 0 && apiOk && (
            <Card glow="violet" className="border-violet-500/20 text-center">
              <p className="text-lg font-medium text-white">Add your first RoRush account</p>
              <p className="mx-auto mt-2 max-w-md text-sm text-slate-400">
                Head to Accounts to save a login, then turn on Join rain and disable Global pause when you’re ready.
              </p>
              <Button className="mt-6" onClick={() => setTab("accounts")}>
                Go to Accounts
              </Button>
            </Card>
          )}

          <Card>
            <SectionTitle
              eyebrow="Live feed"
              title="Recent activity"
              description="Latest events from the automation engine."
              action={
                logs.length > 5 ? (
                  <Button variant="ghost" size="sm" onClick={() => setTab("activity")}>
                    View all
                  </Button>
                ) : undefined
              }
            />
            <ActivityFeed logs={logs.slice(0, 8)} accountsById={accountsById} compact maxHeight="420px" />
          </Card>
        </div>
      )}

      {tab === "accounts" && (
        <div className="space-y-8">
          <SectionTitle
            eyebrow="RoRush"
            title="Accounts"
            description="Each card is one login. Toggle rain, cases, and codes independently."
          />

          <div className="grid gap-6 lg:grid-cols-5">
            <Card glow="mint" className="lg:col-span-2 lg:sticky lg:top-28 lg:self-start">
              <SectionTitle
                title="Add account"
                description="Nickname plus rorush.com email & password, or a session JWT if you use 2FA."
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
                <details className="rounded-xl border border-white/[0.06] bg-black/20 px-3 py-2 text-sm text-slate-500">
                  <summary className="cursor-pointer text-violet-300/90">Session JWT (advanced)</summary>
                  <Input
                    className="mt-2"
                    placeholder="Paste JWT from browser DevTools"
                    value={newSession}
                    onChange={(e) => setNewSession(e.target.value)}
                  />
                </details>
                <Button size="lg" disabled={savingAccount} onClick={() => void createAccount()}>
                  {savingAccount ? "Saving…" : "Save account"}
                </Button>
              </div>
            </Card>

            <div className="space-y-4 lg:col-span-3">
              {accounts.length === 0 ? (
                <Card className="border-dashed border-white/10 py-16 text-center">
                  <p className="text-slate-400">No accounts yet — add one on the left.</p>
                </Card>
              ) : (
                accounts.map((a) => (
                  <AccountCard
                    key={a.id}
                    account={a}
                    onAccountUpdate={mergeAccount}
                    onRemove={removeAccountById}
                  />
                ))
              )}
            </div>
          </div>
        </div>
      )}

      {tab === "activity" && (
        <div className="space-y-6">
          <SectionTitle
            eyebrow="Live"
            title="Activity log"
            description="Rain attempts, case opens, limbo wagers, and system messages. Secrets never appear here."
          />
          <Card padding="lg">
            <ActivityFeed logs={logs} accountsById={accountsById} />
          </Card>
        </div>
      )}

      {tab === "settings" && (
        <div className="space-y-8">
          <SectionTitle
            eyebrow="Configuration"
            title="Settings"
            description="Discord watcher and setup help. Engine secrets live in your .env file."
          />

          <SetupGuide apiOk={apiOk} hasAccounts={accounts.length > 0} />

          <Card glow="violet">
            <SectionTitle
              title="Private thread reports"
              description="Post limbo hits/misses, rain results, and your account list to a Discord thread via webhook. Create a webhook inside the private thread (Integrations → Webhooks)."
            />
            <div className="grid max-w-lg gap-4">
              {settings && (
                <Toggle
                  label="Send reports to thread"
                  description="Limbo, rain, account changes"
                  checked={settings.discordReportEnabled ?? false}
                  onChange={async (v) => {
                    const s = await dashboardApi.patchSettings({ discordReportEnabled: v });
                    setSettings(s);
                  }}
                />
              )}
              <Input
                type="password"
                placeholder={
                  settings?.hasDiscordReportWebhook
                    ? "New webhook URL (leave blank to keep)"
                    : "https://discord.com/api/webhooks/…"
                }
                value={discordReportWebhook}
                onChange={(e) => setDiscordReportWebhook(e.target.value)}
              />
              <div className="flex flex-wrap gap-2">
                <Button
                  variant="soft"
                  onClick={async () => {
                    const s = await dashboardApi.patchSettings({
                      discordReportWebhook: discordReportWebhook || null,
                    });
                    setSettings(s);
                    setDiscordReportWebhook("");
                    toast.push("Report webhook saved", "success");
                  }}
                >
                  Save webhook
                </Button>
                <Button
                  variant="ghost"
                  onClick={async () => {
                    try {
                      await dashboardApi.testDiscordReport();
                      toast.push("Test message sent to your thread", "success");
                    } catch (e) {
                      toast.push(e instanceof Error ? e.message : "Test failed", "error");
                    }
                  }}
                >
                  Send test
                </Button>
              </div>
            </div>
          </Card>

          <Card glow="cyan">
            <SectionTitle
              title="Discord code watcher"
              description="Monitors one channel for promo codes and redeems on accounts with “Redeem codes” enabled."
            />
            <div className="grid max-w-lg gap-4">
              {settings && (
                <Toggle
                  label="Watch channel"
                  description="Poll for new codes every ~45s"
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
                variant="soft"
                onClick={async () => {
                  const s = await dashboardApi.patchSettings({
                    discordChannelId: discordChannel || null,
                    discordToken: discordToken || null,
                  });
                  setSettings(s);
                  setDiscordToken("");
                  toast.push("Discord settings saved", "success");
                }}
              >
                Save Discord settings
              </Button>
            </div>
          </Card>
        </div>
      )}
    </AppShell>
  );
}
