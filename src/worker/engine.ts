import { loadConfig } from "../config.js";
import {
  appendLog,
  getSettings,
  listAccounts,
  updateAccount,
} from "../db/repositories.js";
import { joinRainForAccount, parseRain, rainJoinWindowOpen } from "../automation/rain-join.js";
import {
  msUntilNextCaseUnlock,
  openDueCases,
  refreshAllCaseSchedules,
} from "../automation/case-scheduler.js";
import { pollDiscordChannel } from "../discord/watcher.js";
import { isIgnorableCaseError } from "../automation/case-errors.js";
import { ensureAuthenticated } from "../accounts/session-manager.js";
import { RoRushHub } from "../rorush/signalr-hub.js";
import type { RainState } from "../rorush/types.js";

export class AutomationEngine {
  private running = false;
  private sharedRainHub: RoRushHub | null = null;
  private accountHubs = new Map<number, RoRushHub>();
  private activeRain: RainState | null = null;
  private caseTimer: NodeJS.Timeout | null = null;
  private discordTimer: NodeJS.Timeout | null = null;
  private statusTimer: NodeJS.Timeout | null = null;

  async start(): Promise<void> {
    if (this.running) return;
    this.running = true;
    appendLog({ category: "system", message: "Automation engine started" });
    await this.ensureSharedRainListener();
    await refreshAllCaseSchedules();
    this.scheduleCaseLoop();
    this.discordTimer = setInterval(() => {
      void this.safeRun(pollDiscordChannel());
    }, 45_000);
    this.statusTimer = setInterval(() => {
      void this.safeRun(this.refreshAccountStats());
    }, 120_000);
  }

  async stop(): Promise<void> {
    this.running = false;
    if (this.caseTimer) clearTimeout(this.caseTimer);
    if (this.discordTimer) clearInterval(this.discordTimer);
    if (this.statusTimer) clearInterval(this.statusTimer);
    await this.sharedRainHub?.disconnect();
    for (const hub of this.accountHubs.values()) {
      await hub.disconnect();
    }
    this.accountHubs.clear();
    appendLog({ category: "system", message: "Automation engine stopped" });
  }

  private async safeRun(fn: Promise<void>): Promise<void> {
    try {
      await fn;
    } catch (err) {
      appendLog({
        category: "system",
        message: "Unhandled worker error",
        detail: err instanceof Error ? err.message : String(err),
      });
    }
  }

  private scheduleCaseLoop(): void {
    const tick = async () => {
      if (!this.running) return;
      const settings = getSettings();
      if (!settings.global_pause) {
        await this.safeRun(openDueCases(this.accountHubs).then(() => undefined));
      }
      const delay = msUntilNextCaseUnlock();
      this.caseTimer = setTimeout(tick, delay);
    };
    void tick();
  }

  private async ensureSharedRainListener(): Promise<void> {
    const listener = listAccounts().find((a) => a.session_jwt_enc || a.password_enc);
    if (!listener) {
      appendLog({ category: "rain", message: "No account available for shared rain listener" });
      return;
    }

    const { creds } = await ensureAuthenticated(listener.id);
    const proxy = loadConfig().RORUSH_PROXY_URL ?? listener.proxy_url;
    this.sharedRainHub = new RoRushHub(creds, {}, proxy);
    await this.sharedRainHub.connect();
    await this.sharedRainHub.subscribeRain();

    this.sharedRainHub.on("ReceiveRainCreated", (payload) => {
      const rain = parseRain(payload);
      if (rain) {
        this.activeRain = rain;
        void this.onRainMaybeJoin(rain);
      }
    });
    this.sharedRainHub.on("ReceiveRainJoinStageStart", (payload) => {
      const rain = parseRain(payload) ?? this.activeRain;
      if (rain) {
        this.activeRain = rain;
        void this.onRainMaybeJoin(rain);
      }
    });
    this.sharedRainHub.on("ReceiveCurrentRains", (payload) => {
      if (Array.isArray(payload)) {
        for (const item of payload) {
          const rain = parseRain(item);
          if (rain) this.activeRain = rain;
        }
      }
    });
  }

  private async onRainMaybeJoin(rain: RainState): Promise<void> {
    const settings = getSettings();
    if (settings.global_pause) return;
    if (!rainJoinWindowOpen(rain)) return;

    const accounts = listAccounts().filter((a) => a.join_rain);
    await Promise.all(
      accounts.map(async (account) => {
        try {
          const { creds } = await ensureAuthenticated(account.id);
          let hub = this.accountHubs.get(account.id);
          if (!hub) {
            hub = new RoRushHub(creds, {}, account.proxy_url);
            await hub.connect();
            this.accountHubs.set(account.id, hub);
          }
          await joinRainForAccount({ accountId: account.id, rain, hub });
        } catch (err) {
          appendLog({
            accountId: account.id,
            category: "rain",
            message: "Rain join pipeline error",
            detail: err instanceof Error ? err.message : String(err),
          });
        }
      }),
    );
  }

  private async refreshAccountStats(): Promise<void> {
    for (const account of listAccounts()) {
      try {
        const { client } = await ensureAuthenticated(account.id);
        const [balance, level] = await Promise.all([
          client.getBalance(),
          client.getLevel(),
        ]);
        const patch: Parameters<typeof updateAccount>[1] = {
          balance: typeof balance.balance === "number" ? balance.balance / 100 : null,
          level: level.level ?? null,
          status: "idle",
        };
        const row = listAccounts().find((a) => a.id === account.id);
        if (row?.last_error && isIgnorableCaseError(row.last_error)) {
          patch.last_error = null;
        }
        updateAccount(account.id, patch);
      } catch {
        /* logged in ensureAuthenticated */
      }
    }
  }

  async reloadAccounts(): Promise<void> {
    await refreshAllCaseSchedules();
    await this.sharedRainHub?.disconnect();
    this.sharedRainHub = null;
    await this.ensureSharedRainListener();
  }
}

export const engine = new AutomationEngine();
