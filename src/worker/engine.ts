import { captchaApiKey, loadConfig, reloadEnv } from "../config.js";
import { clearActivityDedupeForRain } from "../db/activity-dedupe.js";
import {
  appendLog,
  getSettings,
  listAccounts,
  updateAccount,
} from "../db/repositories.js";
import { clearRainCaptcha, prewarmRainCaptcha, takeRainCaptchaToken } from "../automation/rain-captcha.js";
import { clearRainJoinStateForRain, isRainJoined } from "../automation/rain-join-state.js";
import {
  isRetryableRainFailure,
  joinRainForAccount,
  parseRain,
  rainCaptchaPrewarmWindow,
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
  private rainSettlementDone = new Set<string>();
  /** One dashboard line per rain lifecycle step (created / join stage / finished). */
  private rainLifecycleLogged = new Set<string>();
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
        this.logRainLifecycleOnce("created", rain.rainId, () =>
          appendLog({
            category: "rain",
            message: "Rain created",
            detail: `${rain.rainId} · pool ${rain.amount ?? "?"} coins`,
          }),
        );
        prewarmRainCaptcha(rain.rainId);
      }
    });
    this.sharedRainHub.on(SIGNALR.rain.receiveJoinStageStart, (payload) => {
      const partial = parseRain(payload);
      const rain = partial ? this.mergeRainState(partial) : this.activeRain;
      if (rain) {
        this.activeRain = rain;
        this.logRainLifecycleOnce("join_stage", rain.rainId, () =>
          appendLog({
            category: "rain",
            message: "Rain join stage started",
            detail: `${rain.rainId} · window ${rainJoinWindowOpen(rain) ? "open" : "closed"}`,
          }),
        );
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
        if (rainCaptchaPrewarmWindow(this.activeRain)) {
          prewarmRainCaptcha(this.activeRain.rainId);
        }
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
      if (this.activeRain) {
        if (rainCaptchaPrewarmWindow(this.activeRain)) {
          prewarmRainCaptcha(this.activeRain.rainId);
        }
        if (rainJoinWindowOpen(this.activeRain)) {
          this.scheduleRainJoinAttempt(this.activeRain, "amount_updated");
        }
      }
    });

    this.sharedRainHub.on(SIGNALR.rain.receiveFinished, (payload) => {
      const p = payload as { rainId?: string };
      if (!p.rainId) return;
      const pool = this.activeRain?.rainId === p.rainId ? this.activeRain.amount : undefined;
      if (this.activeRain?.rainId === p.rainId) {
        this.activeRain = null;
      }
      if (this.rainSettlementDone.has(p.rainId)) return;
      this.rainSettlementDone.add(p.rainId);
      this.logRainLifecycleOnce("finished", p.rainId, () =>
        appendLog({ category: "rain", message: "Rain finished", detail: p.rainId }),
      );
      clearActivityDedupeForRain(p.rainId);
      clearRainJoinStateForRain(p.rainId);
      clearRainCaptcha(p.rainId);
      void settleRainForAllJoiners({
        rainId: p.rainId,
        poolCoins: pool,
        hubs: this.accountHubs,
      });
    });
  }

  private logRainLifecycleOnce(step: string, rainId: string, log: () => void): void {
    const key = `${step}:${rainId}`;
    if (this.rainLifecycleLogged.has(key)) return;
    this.rainLifecycleLogged.add(key);
    log();
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
      return;
    }

    const joinEnabled = listAccounts().filter((a) => Number(a.join_rain) !== 0);
    const accounts = joinEnabled.filter((a) => !isRainJoined(a.id, rain.rainId));
    if (joinEnabled.length === 0) {
      appendLog({
        category: "rain",
        message: "Rain join skipped (no accounts with Join rain enabled)",
        detail: rain.rainId,
      });
      return;
    }
    if (accounts.length === 0) {
      appendLog({
        category: "rain",
        message: "Rain join skipped (every account already joined this rain)",
        detail: rain.rainId,
      });
      return;
    }

    if (this.rainJoinInFlight.has(rain.rainId)) return;

    const nickList = accounts.map((a) => a.nickname).join(", ");
    appendLog({
      category: "rain",
      message: "Attempting rain join",
      detail: `${rain.rainId} · ${accounts.length} account(s): ${nickList} · ${trigger}`,
    });

    this.rainJoinInFlight.add(rain.rainId);
    let sharedCaptcha: string | null = await takeRainCaptchaToken(rain.rainId, {
      forRainJoin: true,
    }).catch(() => null);
    try {
      for (const account of accounts) {
        try {
          const hub = await this.accountHubs.ensure(account.id, { rain: true, cases: true });
          const result = await joinRainForAccount({
            accountId: account.id,
            rain,
            hub,
            captchaToken: sharedCaptcha,
          });
          if (result.success) sharedCaptcha = null;
          if (!result.success && /captcha|token/i.test(result.reason)) {
            sharedCaptcha = null;
            prewarmRainCaptcha(rain.rainId);
          }
          // Only retry wager blocks — captcha/timeouts used to re-queue and spam "Rain join error".
          const retryable =
            !result.success && rainJoinWindowOpen(rain) && isRetryableRainFailure(result.reason);
          if (retryable) {
            this.rainJoinLastAttempt.delete(rain.rainId);
            prewarmRainCaptcha(rain.rainId);
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
    if (accounts.length > 1) {
      appendLog({
        category: "rain",
        message: "Rain join batch finished",
        detail: `${rain.rainId} · ${accounts.length} account(s) processed`,
      });
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
        const patch: Parameters<typeof updateAccount>[1] = {};
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
          patch.status = "idle";
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
    this.rainLifecycleLogged.clear();
    this.rainSettlementDone.clear();
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
