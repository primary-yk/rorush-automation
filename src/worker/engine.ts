import { captchaApiKey, loadConfig, reloadEnv } from "../config.js";
import { clearActivityDedupeForRain } from "../db/activity-dedupe.js";
import {
  appendLog,
  getSettings,
  listAccounts,
  updateAccount,
  type AccountRow,
} from "../db/repositories.js";
import {
  consumeRainCaptchaToken,
  isRainCaptchaFinished,
  markRainCaptchaFinished,
  prewarmRainCaptchasParallel,
  shouldInvalidateRainCaptcha,
  takeRainCaptchaToken,
} from "../automation/rain-captcha.js";
import { clearRainJoinStateForRain, isRainJoined } from "../automation/rain-join-state.js";
import {
  isPermanentRainJoinFailure,
  joinRainForAccount,
  parseRain,
  rainCaptchaPrewarmWindow,
  rainCaptchaSolveWindow,
  rainJoinWindowOpen,
  rainJoinWindowRemainingMs,
  runPreRainWagerIfEnabled,
  runTestLimboBet,
  settleRainForAllJoiners,
} from "../automation/rain-join.js";
import { fetchCaptchaBalanceSnapshot } from "../captcha/balance-cache.js";
import {
  reportCaptchaBalanceLow,
  reportRainJoinWindowOpen,
} from "../discord/reporter.js";
import {
  msUntilNextCaseUnlock,
  openDueCases,
  refreshAllCaseSchedules,
} from "../automation/case-scheduler.js";
import { pollDiscordChannel } from "../discord/watcher.js";
import { isIgnorableCaseError } from "../automation/case-errors.js";
import { accountEligibleForRain } from "../accounts/account-automation.js";
import { ensureAuthenticated } from "../accounts/session-manager.js";
import { SIGNALR } from "../rorush/endpoints.js";
import { RoRushHub } from "../rorush/signalr-hub.js";
import type { RainState } from "../rorush/types.js";
import { parseBalanceCents, parseLevel } from "../rorush/balance-level.js";
import {
  buildRainLiveStatus,
  formatRainJoinSummary,
  rainTelemetryGet,
  rainTelemetryAccountFailed,
  rainTelemetryAccountJoined,
  rainTelemetryFinish,
  rainTelemetryAccountPhase,
  rainTelemetryAccountSkipped,
  rainTelemetryJoinAttempt,
  rainTelemetryOnCreated,
  rainTelemetrySyncJoinAccounts,
  rainTelemetryUpdateWindow,
} from "../automation/rain-telemetry.js";
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
  private hubHealthTimer: NodeJS.Timeout | null = null;
  private rainPrepTimer: NodeJS.Timeout | null = null;
  private rainListenerRecovering = false;
  private lastListenerDisconnectLogMs = 0;
  private rainPrepLogged = new Set<string>();
  private rainSkipLogged = new Set<string>();
  private rainJoinWindowDiscordLogged = new Set<string>();
  private preWagerDoneForRain = new Set<string>();
  private captchaLowBalanceAlerted = false;
  private captchaBalanceTimer: NodeJS.Timeout | null = null;
  private rainJoinWaitLogKeys = new Set<string>();

  private rainJoinScheduleDebounceMs(): number {
    return Math.max(3_000, Number(process.env.RAIN_JOIN_SCHEDULE_DEBOUNCE_MS ?? 5_000) || 5_000);
  }

  private rainCaptchaWaitSliceMs(): number {
    return Math.max(2_000, Number(process.env.RAIN_CAPTCHA_WAIT_SLICE_MS ?? 12_000) || 12_000);
  }

  private rainJoinInterAttemptMs(): number {
    return Math.max(1_500, Number(process.env.RAIN_JOIN_INTER_ATTEMPT_MS ?? 3_000) || 3_000);
  }

  private rainJoinTriesPerWindow(): number {
    return Math.max(8, Number(process.env.RAIN_JOIN_TRIES_PER_WINDOW ?? 24) || 24);
  }

  /** Join-enabled accounts all marked joined for this rain — ignore further join triggers. */
  private joinEnabledAllInRain(rainId: string): boolean {
    const joinEnabled = listAccounts().filter((a) => accountEligibleForRain(a));
    if (joinEnabled.length === 0) return false;
    return joinEnabled.every((a) => isRainJoined(a.id, rainId));
  }

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
    this.hubHealthTimer = setInterval(() => {
      void this.safeRun(this.maintainSharedRainListener());
    }, 45_000);
    const rainPrepMs = Math.max(5_000, Number(process.env.RAIN_PREP_TICK_MS ?? 10_000) || 10_000);
    this.rainPrepTimer = setInterval(() => {
      void this.safeRun(this.maintainActiveRainPrep());
    }, rainPrepMs);
    this.captchaBalanceTimer = setInterval(() => {
      void this.safeRun(this.checkCaptchaBalance());
    }, 300_000);
    void this.safeRun(this.refreshAccountStats());
    void this.safeRun(this.checkCaptchaBalance());
  }

  /** Refresh balance/level for all accounts (dashboard + logs). */
  async refreshAccountStatsNow(): Promise<void> {
    await this.refreshAccountStats();
  }

  async refreshAccountStatsForIds(
    accountIds: number[],
  ): Promise<Array<{ accountId: number; ok: boolean; error?: string }>> {
    const ids = [...new Set(accountIds.filter((id) => Number.isFinite(id)))];
    const results: Array<{ accountId: number; ok: boolean; error?: string }> = [];
    for (const id of ids) {
      results.push(await this.refreshOneAccountStats(id));
    }
    return results;
  }

  async stop(): Promise<void> {
    this.running = false;
    if (this.caseTimer) clearTimeout(this.caseTimer);
    if (this.discordTimer) clearInterval(this.discordTimer);
    if (this.statusTimer) clearInterval(this.statusTimer);
    if (this.hubHealthTimer) clearInterval(this.hubHealthTimer);
    if (this.rainPrepTimer) clearInterval(this.rainPrepTimer);
    if (this.captchaBalanceTimer) clearInterval(this.captchaBalanceTimer);
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

  private joinRainEnabledAccounts(): AccountRow[] {
    return listAccounts().filter((a) => accountEligibleForRain(a));
  }

  private joinRainEligibleAccounts(rain: RainState): AccountRow[] {
    const pool = rain.amount ?? 0;
    return this.joinRainEnabledAccounts().filter(
      (a) => !isRainJoined(a.id, rain.rainId) && pool >= a.min_rain_amount,
    );
  }

  private logRainMinPoolSkips(rain: RainState): void {
    const pool = rain.amount ?? 0;
    for (const a of this.joinRainEnabledAccounts()) {
      if (isRainJoined(a.id, rain.rainId)) continue;
      if (pool >= a.min_rain_amount) continue;
      const key = `${rain.rainId}:${a.id}`;
      if (this.rainSkipLogged.has(key)) continue;
      this.rainSkipLogged.add(key);
      appendLog({
        accountId: a.id,
        category: "rain",
        message: "Rain join skipped (pool below minimum)",
        detail: `pool ${pool.toFixed(2)} · min ${a.min_rain_amount.toFixed(2)} coins`,
      });
      rainTelemetryAccountSkipped(
        rain.rainId,
        a.id,
        a.nickname,
        `Pool ${pool.toFixed(0)} < min ${a.min_rain_amount.toFixed(0)}`,
      );
    }
  }

  /** Hub warm-up early; paid captcha only in the solve window (tokens stay fresh). */
  private kickoffRainJoinPrep(rain: RainState): void {
    if (!rain.rainId || isRainCaptchaFinished(rain.rainId)) return;
    this.logRainMinPoolSkips(rain);
    const eligible = this.joinRainEligibleAccounts(rain);
    const joinIds = eligible.map((a) => a.id);
    if (joinIds.length === 0) return;

    if (rainCaptchaPrewarmWindow(rain)) {
      void this.safeRun(this.preconnectJoinRainHubs(joinIds));
    }

    const solveWindow = rainCaptchaSolveWindow(rain) || rainJoinWindowOpen(rain);
    if (!solveWindow) return;

    if (!this.rainPrepLogged.has(rain.rainId)) {
      this.rainPrepLogged.add(rain.rainId);
      appendLog({
        category: "rain",
        message: "Rain join prep",
        detail: `${rain.rainId.slice(0, 8)}… · ${joinIds.length} account(s) · captcha + hubs`,
      });
    }

    rainTelemetrySyncJoinAccounts(
      rain.rainId,
      eligible.map((a) => ({ id: a.id, nickname: a.nickname })),
    );
    prewarmRainCaptchasParallel(rain.rainId, joinIds);
    void this.safeRun(this.runPreWagersForRain(rain, eligible));
  }

  private async runPreWagersForRain(rain: RainState, accounts: AccountRow[]): Promise<void> {
    await Promise.all(
      accounts.map(async (account) => {
        const key = `${rain.rainId}:${account.id}`;
        if (this.preWagerDoneForRain.has(key)) return;
        if (!account.pre_wager_before_rain) return;
        this.preWagerDoneForRain.add(key);
        try {
          await runPreRainWagerIfEnabled({ accountId: account.id, rain, hubs: this.accountHubs });
        } catch (err) {
          appendLog({
            accountId: account.id,
            category: "limbo",
            message: "Pre-rain wager failed",
            detail: err instanceof Error ? err.message : String(err),
          });
        }
      }),
    );
  }

  private async checkCaptchaBalance(): Promise<void> {
    if (!captchaApiKey()) return;
    const snap = await fetchCaptchaBalanceSnapshot();
    if (snap.balanceUsd == null) return;
    if (snap.lowBalance && !this.captchaLowBalanceAlerted) {
      appendLog({
        category: "system",
        message: "Captcha balance low",
        detail: `$${snap.balanceUsd.toFixed(2)} · add funds to ${snap.provider ?? "2captcha"}`,
      });
      this.captchaLowBalanceAlerted = true;
      void reportCaptchaBalanceLow({
        balanceUsd: snap.balanceUsd,
        thresholdUsd: snap.lowBalanceThresholdUsd,
        provider: snap.provider ?? "2captcha",
      });
    }
    if (!snap.lowBalance) this.captchaLowBalanceAlerted = false;
  }

  private maybeDiscordJoinWindowOpen(rain: RainState): void {
    if (!rainJoinWindowOpen(rain)) return;
    if (this.rainJoinWindowDiscordLogged.has(rain.rainId)) return;
    this.rainJoinWindowDiscordLogged.add(rain.rainId);
    const eligible = this.joinRainEligibleAccounts(rain);
    const tel = rainTelemetryGet(rain.rainId);
    const ready =
      tel?.accountStatuses.filter((s) => s.phase === "ready" || s.phase === "joined").length ?? 0;
    const solving = tel?.accountStatuses.filter((s) => s.phase === "solving").length ?? 0;
    void reportRainJoinWindowOpen({
      rainId: rain.rainId,
      poolCoins: rain.amount ?? null,
      captchaReady: ready,
      captchaSolving: solving,
      captchaTotal: eligible.length,
      windowSec: Math.round(rainJoinWindowRemainingMs(rain) / 1000),
    });
  }

  private async preconnectJoinRainHubs(accountIds: number[]): Promise<void> {
    await Promise.all(
      accountIds.map(async (accountId) => {
        try {
          await this.accountHubs.ensure(accountId, { rain: true, cases: false });
        } catch (err) {
          appendLog({
            accountId,
            category: "rain",
            message: "Rain hub preconnect skipped",
            detail: err instanceof Error ? err.message : String(err),
          });
        }
      }),
    );
  }

  /** Start prep during tip-stage lead window (SignalR may not emit again until join opens). */
  private async maintainActiveRainPrep(): Promise<void> {
    if (!this.activeRain) return;
    const rain = this.activeRain;
    if (isRainCaptchaFinished(rain.rainId)) return;
    if (!rainCaptchaPrewarmWindow(rain) && !rainJoinWindowOpen(rain)) return;
    this.kickoffRainJoinPrep(rain);
    if (rainJoinWindowOpen(rain)) {
      this.maybeDiscordJoinWindowOpen(rain);
      this.scheduleRainJoinAttempt(rain, "prep_tick");
    }
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

  /** Reconnect shared rain hub after idle SignalR drops (1006 / server timeout). */
  private async maintainSharedRainListener(): Promise<void> {
    if (!this.running || this.rainListenerRecovering) return;
    if (!this.sharedRainHub) {
      await this.ensureSharedRainListener();
      return;
    }
    if (this.sharedRainHub.isConnected()) return;

    this.rainListenerRecovering = true;
    try {
      const now = Date.now();
      if (now - this.lastListenerDisconnectLogMs > 120_000) {
        this.lastListenerDisconnectLogMs = now;
        appendLog({
          category: "rain",
          message: "Rain listener reconnecting",
          detail: "SignalR dropped (idle or network). Auto-recovery — rain joins resume when connected.",
        });
      }
      await this.sharedRainHub.connect();
      await this.sharedRainHub.ensureRainSubscribed();
    } catch (err) {
      appendLog({
        category: "rain",
        message: "Rain listener reconnect failed",
        detail: err instanceof Error ? err.message : String(err),
      });
    } finally {
      this.rainListenerRecovering = false;
    }
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
        rainTelemetryOnCreated(rain);
        rainTelemetryUpdateWindow(rain);
        this.logRainLifecycleOnce("created", rain.rainId, () =>
          appendLog({
            category: "rain",
            message: "Rain created",
            detail: `${rain.rainId} · pool ${rain.amount ?? "?"} coins`,
          }),
        );
        if (rainCaptchaPrewarmWindow(rain)) {
          this.kickoffRainJoinPrep(rain);
        }
      }
    });
    this.sharedRainHub.on(SIGNALR.rain.receiveJoinStageStart, (payload) => {
      const partial = parseRain(payload);
      const rain = partial ? this.mergeRainState(partial) : this.activeRain;
      if (rain) {
        this.activeRain = rain;
        rainTelemetryUpdateWindow(rain);
        this.logRainLifecycleOnce("join_stage", rain.rainId, () =>
          appendLog({
            category: "rain",
            message: "Rain join stage started",
            detail: `${rain.rainId} · window ${rainJoinWindowOpen(rain) ? "open" : "closed"}`,
          }),
        );
        this.kickoffRainJoinPrep(rain);
        this.maybeDiscordJoinWindowOpen(rain);
        this.scheduleRainJoinAttempt(rain, "join_stage");
      }
    });
    this.sharedRainHub.on(SIGNALR.rain.receiveCurrent, (payload) => {
      if (!Array.isArray(payload)) return;
      for (const item of payload) {
        const rain = parseRain(item);
        if (!rain) continue;
        this.activeRain = this.mergeRainState(rain);
        rainTelemetryUpdateWindow(this.activeRain);
        if (rainCaptchaPrewarmWindow(this.activeRain)) {
          this.kickoffRainJoinPrep(this.activeRain);
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
        rainTelemetryUpdateWindow(this.activeRain);
        // Pool tips (owner topping up) must not re-trigger paid captcha solves.
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
      const tel = rainTelemetryFinish(p.rainId);
      if (tel) {
        appendLog({
          category: "rain",
          message: "Rain join summary",
          detail: formatRainJoinSummary(tel),
          force: true,
        });
      }
      clearRainJoinStateForRain(p.rainId);
      markRainCaptchaFinished(p.rainId);
      this.rainPrepLogged.delete(p.rainId);
      this.rainSkipLogged.delete(`${p.rainId}`);
      for (const key of [...this.rainSkipLogged]) {
        if (key.startsWith(`${p.rainId}:`)) this.rainSkipLogged.delete(key);
      }
      this.rainJoinWindowDiscordLogged.delete(p.rainId);
      for (const key of [...this.preWagerDoneForRain]) {
        if (key.startsWith(`${p.rainId}:`)) this.preWagerDoneForRain.delete(key);
      }
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

  /** Keep trying captcha + join for this account until joined or the rain window closes. */
  private async attemptRainJoinForAccount(
    account: AccountRow,
    rainId: string,
  ): Promise<{ retryable: boolean }> {
    const liveRain = (): RainState | null =>
      this.activeRain?.rainId === rainId ? this.activeRain : null;

    if (isRainJoined(account.id, rainId)) return { retryable: false };

    const maxTries = this.rainJoinTriesPerWindow();
    const sliceMs = this.rainCaptchaWaitSliceMs();
    const pauseMs = this.rainJoinInterAttemptMs();
    let tries = 0;
    let hub: Awaited<ReturnType<HubRegistry["ensure"]>> | null = null;

    while (tries < maxTries) {
      tries++;
      const live = liveRain();
      if (!live || !rainJoinWindowOpen(live) || isRainCaptchaFinished(rainId)) {
        break;
      }
      if (isRainJoined(account.id, rainId)) return { retryable: false };

      if (!isRainCaptchaFinished(rainId)) {
        prewarmRainCaptchasParallel(rainId, [account.id]);
      }

      let accountCaptcha: string | null = null;
      while (!accountCaptcha && rainJoinWindowOpen(liveRain() ?? live)) {
        const liveNow = liveRain();
        if (!liveNow || isRainCaptchaFinished(rainId)) break;
        const remaining = rainJoinWindowRemainingMs(liveNow);
        const waitMs = Math.min(sliceMs, remaining);
        if (waitMs < 1_500) break;

        try {
          accountCaptcha = await Promise.race([
            takeRainCaptchaToken(rainId, {
              accountId: account.id,
              forRainJoin: true,
            }),
            new Promise<null>((resolve) => setTimeout(() => resolve(null), waitMs)),
          ]);
        } catch (err) {
          appendLog({
            accountId: account.id,
            category: "rain",
            message: "Rain captcha error",
            detail: err instanceof Error ? err.message : String(err),
          });
        }

        if (!accountCaptcha && rainJoinWindowOpen(liveNow)) {
          const logKey = `${rainId}:${account.id}:wait`;
          if (!this.rainJoinWaitLogKeys.has(logKey)) {
            this.rainJoinWaitLogKeys.add(logKey);
            appendLog({
              accountId: account.id,
              category: "rain",
              message: "Rain captcha still waiting",
              detail: `${account.nickname} · retrying until join window closes`,
            });
          }
        }
      }

      const liveJoin = liveRain();
      if (!liveJoin || !rainJoinWindowOpen(liveJoin) || isRainJoined(account.id, rainId)) {
        break;
      }
      if (!accountCaptcha) {
        await new Promise((r) => setTimeout(r, Math.min(pauseMs, rainJoinWindowRemainingMs(liveJoin))));
        continue;
      }

      try {
        rainTelemetryAccountPhase(liveJoin.rainId, account.id, account.nickname, "joining");
        hub ??= await this.accountHubs.ensure(account.id, { rain: true, cases: true });
        const result = await joinRainForAccount({
          accountId: account.id,
          rain: liveJoin,
          hub,
          captchaToken: accountCaptcha,
        });
        if (result.success) {
          rainTelemetryAccountJoined(liveJoin.rainId, account.nickname);
          consumeRainCaptchaToken(liveJoin.rainId, account.id);
          return { retryable: false };
        }

        rainTelemetryAccountFailed(liveJoin.rainId, account.nickname, result.reason);
        appendLog({
          accountId: account.id,
          category: "rain",
          message: "Rain join failed (will retry)",
          detail: `${account.nickname} · ${result.reason.slice(0, 180)}`,
        });

        if (isPermanentRainJoinFailure(result.reason)) {
          return { retryable: false };
        }

        if (shouldInvalidateRainCaptcha(result.reason)) {
          consumeRainCaptchaToken(liveJoin.rainId, account.id);
          if (!isRainCaptchaFinished(liveJoin.rainId)) {
            prewarmRainCaptchasParallel(liveJoin.rainId, [account.id]);
          }
        }
      } catch (err) {
        appendLog({
          accountId: account.id,
          category: "rain",
          message: "Rain join pipeline error (will retry)",
          detail: err instanceof Error ? err.message : String(err),
        });
      }

      const liveAfter = liveRain();
      if (!liveAfter || !rainJoinWindowOpen(liveAfter)) break;
      const wait = Math.min(pauseMs, rainJoinWindowRemainingMs(liveAfter));
      if (wait < 800) break;
      await new Promise((r) => setTimeout(r, wait));
    }

    const liveEnd = liveRain();
    if (liveEnd && rainJoinWindowOpen(liveEnd) && !isRainJoined(account.id, rainId)) {
      appendLog({
        accountId: account.id,
        category: "rain",
        message: "Rain join missed (window closed or max tries)",
        detail: `${account.nickname} · ${rainId.slice(0, 8)}… · ${tries} attempt(s)`,
        force: true,
      });
    }
    return { retryable: false };
  }

  private scheduleRainJoinAttempt(rain: RainState, trigger: string): void {
    if (this.rainJoinInFlight.has(rain.rainId)) return;
    if (this.joinEnabledAllInRain(rain.rainId)) return;
    const last = this.rainJoinLastAttempt.get(rain.rainId) ?? 0;
    if (Date.now() - last < this.rainJoinScheduleDebounceMs()) return;
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

    const joinEnabled = listAccounts().filter((a) => accountEligibleForRain(a));
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
    try {
      const live =
        this.activeRain?.rainId === rain.rainId ? this.activeRain : rain;
      if (!rainJoinWindowOpen(live)) return;

      const pending = this.joinRainEligibleAccounts(live);
      if (pending.length === 0) {
        const enabled = this.joinRainEnabledAccounts().filter((a) => !isRainJoined(a.id, live.rainId));
        if (enabled.length > 0) {
          appendLog({
            category: "rain",
            message: "Rain join stalled (no eligible pilots)",
            detail: `${live.rainId.slice(0, 8)}… · check min pool vs rain amount`,
          });
        }
        return;
      }

      rainTelemetryJoinAttempt(
        live.rainId,
        pending.map((a) => a.nickname),
      );
      if (!isRainCaptchaFinished(live.rainId)) {
        this.kickoffRainJoinPrep(live);
      }

      const secLeft = Math.round(rainJoinWindowRemainingMs(live) / 1000);
      appendLog({
        category: "rain",
        message: "Rain join active",
        detail: `${live.rainId.slice(0, 8)}… · ~${secLeft}s left · ${pending.length} account(s) · retry until joined or window closes`,
      });

      await Promise.all(
        pending.map((account) => this.attemptRainJoinForAccount(account, live.rainId)),
      );
    } finally {
      this.rainJoinInFlight.delete(rain.rainId);
      for (const key of [...this.rainJoinWaitLogKeys]) {
        if (key.startsWith(`${rain.rainId}:`)) this.rainJoinWaitLogKeys.delete(key);
      }
    }

    const tel = rainTelemetryGet(rain.rainId);
    const joined = accounts.filter((a) => isRainJoined(a.id, rain.rainId)).length;
    const summary =
      tel != null
        ? formatRainJoinSummary(tel)
        : `joined ${joined}/${accounts.length}`;
    appendLog({
      category: "rain",
      message: joined > 0 ? "Rain join batch finished" : "Rain join batch finished (no joins)",
      detail: `${rain.rainId.slice(0, 8)}… · ${summary}`,
      force: joined === 0,
    });
  }

  private async refreshOneAccountStats(
    accountId: number,
  ): Promise<{ accountId: number; ok: boolean; error?: string }> {
    const account = listAccounts().find((a) => a.id === accountId);
    if (!account) return { accountId, ok: false, error: "Account not found" };
    try {
      const { client } = await ensureAuthenticated(account.id);
      const { fetchVaultBalanceCoins } = await import("../rorush/vault.js");
      const [balanceRaw, levelRaw, vaultBal] = await Promise.all([
        client.getBalance(),
        client.getLevel(),
        fetchVaultBalanceCoins(client).catch(() => null),
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
      if (vaultBal != null) patch.vault_balance = vaultBal;
      const row = listAccounts().find((a) => a.id === account.id);
      if (row?.last_error && isIgnorableCaseError(row.last_error)) {
        patch.last_error = null;
        patch.status = "idle";
      }
      updateAccount(account.id, patch);
      return { accountId, ok: true };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      updateAccount(account.id, { status: "error", last_error: message });
      appendLog({
        accountId: account.id,
        category: "system",
        message: "Could not refresh balance/level",
        detail: message,
      });
      return { accountId, ok: false, error: message };
    }
  }

  private async refreshAccountStats(): Promise<void> {
    for (const account of listAccounts()) {
      await this.refreshOneAccountStats(account.id);
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

  getRainLiveStatus() {
    return buildRainLiveStatus({
      rain: this.activeRain,
      listenerConnected: this.sharedRainHub?.isConnected() ?? false,
    });
  }

  async getCaptchaBalanceStatus() {
    return fetchCaptchaBalanceSnapshot();
  }
}

export const engine = new AutomationEngine();
