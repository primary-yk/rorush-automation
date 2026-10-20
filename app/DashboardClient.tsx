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
  const [discordWebhook, setDiscordWebhook] = useState("");
  const [discordReportSaving, setDiscordReportSaving] = useState(false);
  const [relayConnected, setRelayConnected] = useState<boolean | null>(null);
  const [savingAccount, setSavingAccount] = useState(false);

  const apiOk = !error && settings != null;

  const totalEarnings = accounts.reduce((n, a) => n + a.lifetimeEarnings.total, 0);
  const rainEnabled = accounts.filter((a) => a.joinRain).length;
  const casesEnabled = accounts.filter((a) => a.autoOpenCases).length;
  const captchaOk = settings?.captchaConfigured ?? settings?.capmonsterConfigured;
  const captchaMissing = apiOk && rainEnabled > 0 && captchaOk === false;

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
      const statsRefresh = dashboardApi.refreshAccountStats().catch(() => null);
      const [a, l, relay, stats] = await Promise.all([
        dashboardApi.listAccounts(),
        dashboardApi.listLogs(),
        dashboardApi.getDiscordRelayStatus().catch(() => ({ relayConfigured: false, connected: false })),
        statsRefresh,
      ]);
      setAccounts(stats?.accounts?.length ? stats.accounts : a);
      setLogs(l);
      setRelayConnected(relay.connected);
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
      {captchaMissing && (
        <Card className="mb-8 border-amber-500/35 bg-amber-500/[0.08]" glow="none">
          <p className="text-sm font-semibold text-amber-100">Captcha API key missing — rain join will fail</p>
          <p className="mt-2 text-sm leading-relaxed text-slate-400">
            RoRush rain uses <strong className="text-slate-300">hCaptcha</strong>. Use{" "}
            <strong className="text-slate-300">2Captcha</strong> or CapSolver. In{" "}
            <code className="rounded-lg bg-black/40 px-2 py-0.5 font-mono text-xs">~/rush-pilot/.env</code> add:
          </p>
          <pre className="mt-3 overflow-x-auto rounded-lg bg-black/50 p-3 font-mono text-xs text-amber-100/90">
            CAPTCHA_API_KEY=your_2captcha_key{"\n"}CAPTCHA_PROVIDER=2captcha
          </pre>
          <p className="mt-3 text-sm text-slate-400">
            Then <strong className="text-slate-300">Ctrl+C</strong> and restart{" "}
            <code className="font-mono text-xs">npm run dev</code>, run{" "}
            <code className="font-mono text-xs">npm run test-captcha</code>, refresh this page.
          </p>
        </Card>
      )}

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
            <h1 className="font-display text-3xl font-bold tracking-tight sm:text-4xl lg:text-[2.75rem] lg:leading-tight">
              <span className="text-gradient-hero">
                Good to go{accounts.length ? `, ${accounts.length} pilot${accounts.length === 1 ? "" : "s"} active` : ""}
              </span>
            </h1>
            <p className="mt-2 max-w-xl text-slate-400">
              You host the engine on this PC. Friends use slash commands in Discord only — add or remove any
              account here.
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
              title="Discord notifications"
              description="Default: nickname + limbo wagers + rain joins/fails only (emails redacted). Turn on full feed for more lines."
            />
            <div className="grid max-w-xl gap-4">
              {settings && (
                <>
                  <Toggle
                    label="Send to Discord"
                    description="Post limbo wagers and rain joins/failures to Discord (no emails)"
                    checked={settings.discordReportEnabled}
                    onChange={async (v) => {
                      const s = await dashboardApi.patchSettings({ discordReportEnabled: v });
                      setSettings(s);
                    }}
                  />
                  <Toggle
                    label="Full activity feed"
                    description="Also post routine system lines (not just rain/limbo/errors)"
                    checked={settings.discordActivityFeedEnabled}
                    disabled={!settings.discordReportEnabled}
                    onChange={async (v) => {
                      const s = await dashboardApi.patchSettings({ discordActivityFeedEnabled: v });
                      setSettings(s);
                    }}
                  />
                </>
              )}
              <Input
                type="password"
                placeholder={
                  settings?.hasDiscordReportWebhook
                    ? "Webhook URL saved — paste new to replace"
                    : "Discord channel webhook URL"
                }
                value={discordWebhook}
                onChange={(e) => setDiscordWebhook(e.target.value)}
              />
              <p className="text-xs leading-relaxed text-slate-500">
                In Discord: channel → Edit → Integrations → Webhooks → New webhook → copy URL. Or set{" "}
                <code className="text-violet-300/90">DISCORD_BOT_TOKEN</code> +{" "}
                <code className="text-violet-300/90">DISCORD_ACTIVITY_CHANNEL_ID</code> in{" "}
                <code className="text-violet-300/90">.env</code> (bot needs Send Messages).
              </p>
              <div className="flex flex-wrap gap-2">
                <Button
                  variant="soft"
                  disabled={discordReportSaving}
                  onClick={async () => {
                    setDiscordReportSaving(true);
                    try {
                      await dashboardApi.patchSettings({
                        discordReportEnabled: true,
                        discordReportWebhook: discordWebhook || undefined,
                      });
                      const s = await dashboardApi.getSettings();
                      setSettings(s);
                      setDiscordWebhook("");
                      toast.push("Discord webhook saved", "success");
                    } catch (e) {
                      toast.push(e instanceof Error ? e.message : "Save failed", "error");
                    } finally {
                      setDiscordReportSaving(false);
                    }
                  }}
                >
                  Save webhook
                </Button>
                <Button
                  variant="ghost"
                  disabled={discordReportSaving}
                  onClick={async () => {
                    try {
                      await dashboardApi.testDiscordReport();
                      toast.push("Test message sent — check Discord", "success");
                    } catch (e) {
                      toast.push(e instanceof Error ? e.message : "Test failed", "error");
                    }
                  }}
                >
                  Send test
                </Button>
              </div>
            </div>
            <div className="mt-6 rounded-xl border border-white/[0.08] bg-black/30 px-4 py-3 text-sm">
              <p className="font-medium text-slate-200">Vendor bot relay (optional)</p>
              <p className="mt-2 text-slate-400">
                Relay:{" "}
                {relayConnected === true ? (
                  <span className="text-emerald-400">Connected</span>
                ) : relayConnected === false ? (
                  <span className="text-amber-400/90">Off — set DISCORD_BOT_RELAY_URL + /activate</span>
                ) : (
                  <span className="text-slate-500">…</span>
                )}
              </p>
              <p className="mt-2 text-xs text-slate-500">/status · /accounts · /pause · /resume — docs/DISCORD-BOT.md</p>
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
