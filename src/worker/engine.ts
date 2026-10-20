import { captchaApiKey, loadConfig, reloadEnv } from "../config.js";
import {
  appendLog,
  getSettings,
  listAccounts,
  updateAccount,
} from "../db/repositories.js";
import { prewarmRainCaptcha } from "../automation/rain-captcha.js";
import {
  isWagerRejection,
  joinRainForAccount,
  parseRain,
  rainJoinWindowOpen,
  runTestLimboBet,
  settleRainForAllJoiners,
} from "../automation/rain-join.js";
import {
  msUntilNextCaseUnlock,
  openDueCases,
  refreshAllCaseSchedules,
} from "../automation/case-scheduler.js";
import { pollDiscordChannel } from "../discord/watcher.js";
import { isIgnorableCaseError } from "../automation/case-errors.js";
import { ensureAuthenticated } from "../accounts/session-manager.js";
import { SIGNALR } from "../rorush/endpoints.js";
import { RoRushHub } from "../rorush/signalr-hub.js";
import type { RainState } from "../rorush/types.js";
import { parseBalanceCents, parseLevel } from "../rorush/balance-level.js";
import { HubRegistry } from "./hub-registry.js";

export class AutomationEngine {
  private running = false;
  private sharedRainHub: RoRushHub | null = null;
  private readonly accountHubs = new HubRegistry();
  private activeRain: RainState | null = null;
  private rainJoinLastAttempt = new Map<string, number>();
  /** One active join pipeline per rain (captcha + hub invoke can take >90s if overlapped). */
  private rainJoinInFlight = new Set<string>();
  private caseTimer: NodeJS.Timeout | null = null;
  private discordTimer: NodeJS.Timeout | null = null;
  private statusTimer: NodeJS.Timeout | null = null;

  async start(): Promise<void> {
    if (this.running) return;
    this.running = true;
    reloadEnv();
    appendLog({ category: "system", message: "Automation engine started" });
    try {
      await this.ensureSharedRainListener();
    } catch (err) {
      appendLog({
        category: "rain",
        message: "Shared rain listener failed (cases/discord still run)",
        detail: err instanceof Error ? err.message : String(err),
      });
    }
    await refreshAllCaseSchedules();
    this.scheduleCaseLoop();
    this.discordTimer = setInterval(() => {
      void this.safeRun(pollDiscordChannel());
    }, 45_000);
    this.statusTimer = setInterval(() => {
      void this.safeRun(this.refreshAccountStats());
    }, 60_000);
    void this.safeRun(this.refreshAccountStats());
  }

  /** Refresh balance/level for all accounts (dashboard + logs). */
  async refreshAccountStatsNow(): Promise<void> {
    await this.refreshAccountStats();
  }

  async stop(): Promise<void> {
    this.running = false;
    if (this.caseTimer) clearTimeout(this.caseTimer);
    if (this.discordTimer) clearInterval(this.discordTimer);
    if (this.statusTimer) clearInterval(this.statusTimer);
    await this.sharedRainHub?.disconnect();
    this.sharedRainHub = null;
    await this.accountHubs.disconnectAll();
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
        await this.safeRun(openDueCases(this.accountHubs.asMap()).then(() => undefined));
      }
      const delay = msUntilNextCaseUnlock();
      this.caseTimer = setTimeout(tick, delay);
    };
    void tick();
  }

  private async pickRainListenerAccount(): Promise<number | null> {
    const candidates = listAccounts().filter((a) => a.session_jwt_enc || a.password_enc);
    for (const a of candidates) {
      try {
        await ensureAuthenticated(a.id);
        return a.id;
      } catch {
        continue;
      }
    }
    return null;
  }

  private async ensureSharedRainListener(): Promise<void> {
    const listenerId = await this.pickRainListenerAccount();
    if (listenerId == null) {
      appendLog({ category: "rain", message: "No account available for shared rain listener" });
      return;
    }

    const listener = listAccounts().find((a) => a.id === listenerId)!;
    const { creds } = await ensureAuthenticated(listenerId);
    const proxy = loadConfig().RORUSH_PROXY_URL ?? listener.proxy_url;
    this.sharedRainHub = new RoRushHub(creds, {}, proxy);
    await this.sharedRainHub.connect();
    await this.sharedRainHub.ensureRainSubscribed();
    appendLog({
      category: "rain",
      message: "Shared rain listener connected",
      detail: listener.nickname,
    });

    this.sharedRainHub.on(SIGNALR.rain.receiveCreated, (payload) => {
      const rain = parseRain(payload);
      if (rain) {
        this.activeRain = rain;
        appendLog({
          category: "rain",
          message: "Rain created",
          detail: `${rain.rainId} · pool ${rain.amount ?? "?"} coins`,
        });
        prewarmRainCaptcha(rain.rainId);
      }
    });
    this.sharedRainHub.on(SIGNALR.rain.receiveJoinStageStart, (payload) => {
      const partial = parseRain(payload);
      const rain = partial ? this.mergeRainState(partial) : this.activeRain;
      if (rain) {
        this.activeRain = rain;
        appendLog({
          category: "rain",
          message: "Rain join stage started",
          detail: `${rain.rainId} · window ${rainJoinWindowOpen(rain) ? "open" : "closed"}`,
        });
        prewarmRainCaptcha(rain.rainId);
        this.scheduleRainJoinAttempt(rain, "join_stage");
      }
    });
    this.sharedRainHub.on(SIGNALR.rain.receiveCurrent, (payload) => {
      if (!Array.isArray(payload)) return;
      for (const item of payload) {
        const rain = parseRain(item);
        if (!rain) continue;
        this.activeRain = this.mergeRainState(rain);
        if (rainJoinWindowOpen(this.activeRain)) {
          this.scheduleRainJoinAttempt(this.activeRain, "current_rains");
        }
      }
    });

    this.sharedRainHub.on(SIGNALR.rain.receiveAmountUpdated, (payload) => {
      const partial = parseRain(payload);
      if (!partial) return;
      if (this.activeRain?.rainId === partial.rainId) {
        this.activeRain = {
          ...this.activeRain,
          amount: partial.amount ?? this.activeRain.amount,
          joinStageStartTimestamp:
            partial.joinStageStartTimestamp ?? this.activeRain.joinStageStartTimestamp,
          joinStageDuration: partial.joinStageDuration ?? this.activeRain.joinStageDuration,
          createdTimestamp: partial.createdTimestamp ?? this.activeRain.createdTimestamp,
          tipStageDuration: partial.tipStageDuration ?? this.activeRain.tipStageDuration,
        };
      } else {
        this.activeRain = partial;
      }
      if (this.activeRain && rainJoinWindowOpen(this.activeRain)) {
        this.scheduleRainJoinAttempt(this.activeRain, "amount_updated");
      }
    });

    this.sharedRainHub.on(SIGNALR.rain.receiveFinished, (payload) => {
      const p = payload as { rainId?: string };
      if (!p.rainId) return;
      const pool = this.activeRain?.rainId === p.rainId ? this.activeRain.amount : undefined;
      if (this.activeRain?.rainId === p.rainId) {
        this.activeRain = null;
      }
      appendLog({ category: "rain", message: "Rain finished", detail: p.rainId });
      void settleRainForAllJoiners({
        rainId: p.rainId,
        poolCoins: pool,
        hubs: this.accountHubs,
      });
    });
  }

  private mergeRainState(incoming: RainState): RainState {
    if (!this.activeRain || this.activeRain.rainId !== incoming.rainId) {
      return incoming;
    }
    return {
      ...this.activeRain,
      ...incoming,
      joinStageStartTimestamp:
        incoming.joinStageStartTimestamp ?? this.activeRain.joinStageStartTimestamp,
      joinStageDuration: incoming.joinStageDuration ?? this.activeRain.joinStageDuration,
    };
  }

  private scheduleRainJoinAttempt(rain: RainState, trigger: string): void {
    if (this.rainJoinInFlight.has(rain.rainId)) return;
    const last = this.rainJoinLastAttempt.get(rain.rainId) ?? 0;
    if (Date.now() - last < 12_000) return;
    this.rainJoinLastAttempt.set(rain.rainId, Date.now());
    void this.onRainMaybeJoin(rain, trigger);
  }

  private async onRainMaybeJoin(rain: RainState, trigger: string): Promise<void> {
    reloadEnv();
    const settings = getSettings();
    if (settings.global_pause) {
      appendLog({ category: "rain", message: "Rain join skipped (global pause)", detail: rain.rainId });
      return;
    }
    if (!captchaApiKey()) {
      appendLog({
        category: "rain",
        message: "Rain join skipped (captcha API key missing in .env)",
        detail:
          "RoRush rain needs hCaptcha — use CAPTCHA_API_KEY + CAPTCHA_PROVIDER=2captcha (CapMonster no longer supports hCaptcha)",
      });
      return;
    }
    if (!rainJoinWindowOpen(rain)) {
      appendLog({
        category: "rain",
        message: "Rain join window not open yet",
        detail: `${rain.rainId} · trigger ${trigger}`,
      });
      return;
    }

    const accounts = listAccounts().filter((a) => a.join_rain);
    if (accounts.length === 0) {
      appendLog({
        category: "rain",
        message: "Rain join skipped (no accounts with Join rain enabled)",
        detail: rain.rainId,
      });
      return;
    }

    if (this.rainJoinInFlight.has(rain.rainId)) return;

    appendLog({
      category: "rain",
      message: "Attempting rain join",
      detail: `${rain.rainId} · ${accounts.length} account(s) · ${trigger}`,
    });

    this.rainJoinInFlight.add(rain.rainId);
    try {
      for (const account of accounts) {
        try {
          const hub = await this.accountHubs.ensure(account.id, { rain: true, cases: true });
          const result = await joinRainForAccount({ accountId: account.id, rain, hub });
          // Only retry wager blocks — captcha/timeouts used to re-queue and spam "Rain join error".
          const retryable =
            !result.success && rainJoinWindowOpen(rain) && isWagerRejection(result.reason);
          if (retryable) {
            this.rainJoinLastAttempt.delete(rain.rainId);
            this.scheduleRainJoinAttempt(rain, "retry_after_fail");
          }
        } catch (err) {
          appendLog({
            accountId: account.id,
            category: "rain",
            message: "Rain join pipeline error",
            detail: err instanceof Error ? err.message : String(err),
          });
        }
      }
    } finally {
      this.rainJoinInFlight.delete(rain.rainId);
    }
  }

  private async refreshAccountStats(): Promise<void> {
    for (const account of listAccounts()) {
      try {
        const { client } = await ensureAuthenticated(account.id);
        const [balanceRaw, levelRaw] = await Promise.all([
          client.getBalance(),
          client.getLevel(),
        ]);
        const balanceRawAmount = parseBalanceCents(balanceRaw);
        const level = parseLevel(levelRaw);
        const patch: Parameters<typeof updateAccount>[1] = { status: "idle" };
        if (balanceRawAmount != null) {
          patch.balance =
            Number.isInteger(balanceRawAmount) && Math.abs(balanceRawAmount) >= 100
              ? balanceRawAmount / 100
              : balanceRawAmount;
        }
        if (level != null) patch.level = level;
        const row = listAccounts().find((a) => a.id === account.id);
        if (row?.last_error && isIgnorableCaseError(row.last_error)) {
          patch.last_error = null;
        }
        updateAccount(account.id, patch);
      } catch (err) {
        appendLog({
          accountId: account.id,
          category: "system",
          message: "Could not refresh balance/level",
          detail: err instanceof Error ? err.message : String(err),
        });
      }
    }
  }

  async reloadAccounts(): Promise<void> {
    await this.accountHubs.disconnectAll();
    await refreshAllCaseSchedules();
    await this.sharedRainHub?.disconnect();
    this.sharedRainHub = null;
    this.activeRain = null;
    this.rainJoinLastAttempt.clear();
    await this.ensureSharedRainListener();
    void this.safeRun(this.refreshAccountStats());
  }

  async disconnectAccountHub(accountId: number): Promise<void> {
    await this.accountHubs.disconnect(accountId);
  }

  async refreshCaseSchedulesOnly(): Promise<void> {
    await refreshAllCaseSchedules();
  }

  async testLimbo(
    accountId: number,
    betCoins: number,
    multiplier?: number,
  ): Promise<{ betCoins: number; hit: boolean }> {
    return runTestLimboBet({
      accountId,
      betCoins,
      multiplier,
      hubs: this.accountHubs,
    });
  }
}

export const engine = new AutomationEngine();
