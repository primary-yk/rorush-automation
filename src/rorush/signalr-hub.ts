import {
  HubConnection,
  HubConnectionBuilder,
  HubConnectionState,
  LogLevel,
} from "@microsoft/signalr";
import { loadConfig } from "../config.js";
import { SIGNALR, RORUSH_PATHS } from "./endpoints.js";
import type { RoRushCredentials } from "./http-client.js";

export type HubHandlers = {
  onRainCreated?: (rain: unknown) => void;
  onRainFailure?: (payload: { message?: string; reqId?: string }) => void;
  onRainJoinSuccess?: (payload: { reqId?: string }) => void;
  onCurrentRains?: (rains: unknown) => void;
  onLimboResult?: (payload: unknown) => void;
  onLimboFailure?: (payload: { message?: string }) => void;
  onCaseResult?: (payload: unknown) => void;
  onCaseFailure?: (payload: { message?: string }) => void;
};

/** RoRush / SignalR may invoke PascalCase, camelCase, or all-lowercase client methods. */
export function hubEventVariants(canonical: string): string[] {
  const camel = canonical.charAt(0).toLowerCase() + canonical.slice(1);
  const lower = canonical.toLowerCase();
  return [...new Set([canonical, camel, lower])];
}

const HUB_EVENT_DEDUPE_MS = 2_000;

function signalRTimeouts(): { serverTimeoutMs: number; keepAliveMs: number } {
  const serverTimeoutMs = Math.max(
    30_000,
    Number(process.env.SIGNALR_SERVER_TIMEOUT_MS ?? 180_000) || 180_000,
  );
  const keepAliveMs = Math.max(
    5_000,
    Math.min(60_000, Number(process.env.SIGNALR_KEEPALIVE_MS ?? 15_000) || 15_000),
  );
  return { serverTimeoutMs, keepAliveMs };
}

export class RoRushHub {
  private connection: HubConnection | null = null;
  private readonly listeners = new Map<string, Set<(payload: unknown) => void>>();
  /** Registered SignalR method names (any casing). */
  private readonly boundEvents = new Set<string>();
  /** RoRush sometimes invokes the same rain/limbo event multiple times (or via several casings). */
  private readonly recentEventKeys = new Map<string, number>();
  private rainSubscribed = false;
  private caseSubscribed = false;
  private wantRain = false;
  private wantCases = false;

  constructor(
    private readonly creds: RoRushCredentials,
    private readonly handlers: HubHandlers = {},
    private readonly accountProxyUrl?: string | null,
  ) {}

  private hubUrl(): string {
    const cfg = loadConfig();
    const apiKeyQuery = this.creds.apiKey ? `&api_key=${encodeURIComponent(this.creds.apiKey)}` : "";
    return `${cfg.RORUSH_API_BASE}${RORUSH_PATHS.hubPath}?x-sec-rush=${cfg.RORUSH_SEC_RUSH}${apiKeyQuery}`;
  }

  isConnected(): boolean {
    return this.connection?.state === HubConnectionState.Connected;
  }

  async connect(): Promise<void> {
    if (this.connection?.state === HubConnectionState.Connected) return;

    if (
      this.connection &&
      (this.connection.state === HubConnectionState.Connecting ||
        this.connection.state === HubConnectionState.Reconnecting)
    ) {
      return;
    }

    if (this.connection?.state === HubConnectionState.Disconnected) {
      try {
        await this.connection.start();
        await this.resubscribeAfterReconnect();
        return;
      } catch {
        try {
          await this.connection.stop();
        } catch {
          /* ignore */
        }
        this.connection = null;
        this.boundEvents.clear();
      }
    }

    const { serverTimeoutMs, keepAliveMs } = signalRTimeouts();
    const builder = new HubConnectionBuilder()
      .withUrl(this.hubUrl(), {
        accessTokenFactory: () => this.creds.jwt,
        withCredentials: true,
        skipNegotiation: true,
        transport: 1,
      })
      .withAutomaticReconnect([0, 2000, 5000, 10_000, 30_000, 60_000])
      .configureLogging(LogLevel.Warning);

    this.connection = builder.build();
    this.connection.serverTimeoutInMilliseconds = serverTimeoutMs;
    this.connection.keepAliveIntervalInMilliseconds = keepAliveMs;
    this.boundEvents.clear();
    this.connection.onreconnected(async () => {
      await this.resubscribeAfterReconnect();
    });
    this.connection.onclose((err) => {
      if (err) {
        console.warn("[signalr] connection closed:", err.message);
      }
    });
    this.wireEvents();
    for (const event of this.listeners.keys()) {
      this.bindEvent(event);
    }
    await this.connection.start();
  }

  private async resubscribeAfterReconnect(): Promise<void> {
    this.rainSubscribed = false;
    this.caseSubscribed = false;
    try {
      if (this.wantRain) await this.ensureRainSubscribed();
      if (this.wantCases) await this.ensureCaseSubscribed();
    } catch (err) {
      console.warn(
        "[signalr] re-subscribe after reconnect failed:",
        err instanceof Error ? err.message : String(err),
      );
    }
  }

  async disconnect(): Promise<void> {
    if (!this.connection) return;
    if (this.connection.state === HubConnectionState.Connected) {
      try {
        await this.connection.invoke(SIGNALR.rain.unsubscribe);
      } catch {
        /* ignore */
      }
    }
    await this.connection.stop();
    this.connection = null;
    this.boundEvents.clear();
    this.rainSubscribed = false;
    this.caseSubscribed = false;
    this.wantRain = false;
    this.wantCases = false;
  }

  async ensureRainSubscribed(): Promise<void> {
    this.wantRain = true;
    if (this.rainSubscribed) return;
    await this.subscribeRain();
    this.rainSubscribed = true;
  }

  async ensureCaseSubscribed(): Promise<void> {
    this.wantCases = true;
    if (this.caseSubscribed) return;
    await this.subscribeCaseUnboxing();
    this.caseSubscribed = true;
  }

  private wireEvents(): void {
    if (!this.connection) return;

    this.bindEvent(SIGNALR.rain.receiveCreated, this.handlers.onRainCreated);
    this.bindEvent(SIGNALR.rain.receiveFailure, (p) =>
      this.handlers.onRainFailure?.(p as { message?: string; reqId?: string }),
    );
    this.bindEvent(SIGNALR.rain.receiveJoinSuccess, (p) =>
      this.handlers.onRainJoinSuccess?.(p as { reqId?: string }),
    );
    this.bindEvent(SIGNALR.rain.receiveCurrent, this.handlers.onCurrentRains);
    this.bindEvent(SIGNALR.rain.receiveJoinStageStart);
    this.bindEvent(SIGNALR.rain.receiveAmountUpdated);
    this.bindEvent(SIGNALR.rain.receiveFinished);
    this.bindEvent(SIGNALR.rain.receiveJoinRain);
    this.bindEvent(SIGNALR.limbo.receiveResult, this.handlers.onLimboResult);
    this.bindEvent(SIGNALR.limbo.receiveResultAlt, this.handlers.onLimboResult);
    this.bindEvent(SIGNALR.limbo.receiveFailure, (p) =>
      this.handlers.onLimboFailure?.(p as { message?: string }),
    );
    this.bindEvent(SIGNALR.caseUnboxing.receiveResult, this.handlers.onCaseResult);
    this.bindEvent(SIGNALR.caseUnboxing.receiveFailure, (p) =>
      this.handlers.onCaseFailure?.(p as { message?: string }),
    );

    for (const extra of [
      "ReceiveBalanceUpdate",
      "ReceiveUserBalanceUpdate",
      "ReceiveRainJoinFailure",
      "ReceivePrivateRainJoinSuccess",
    ]) {
      this.bindEvent(extra);
    }

    for (const chatEvent of [
      "ping",
      "Ping",
      "updateglobalstate",
      "UpdateGlobalState",
      "receivechatmessage",
      "ReceiveChatMessage",
      "receivechathistory",
      "ReceiveChatHistory",
      "receiveuserdata",
      "ReceiveUserData",
      "receivemanagerraintipped",
      "ReceiveManagerRainTipped",
      "receivelevelprogress",
      "ReceiveLevelProgress",
      "receiveremovechatmessage",
      "ReceiveRemoveChatMessage",
    ]) {
      this.bindEvent(chatEvent);
    }
  }

  /** @internal exported for unit tests */
  eventDedupeKey(canonical: string, payload: unknown): string {
    if (payload && typeof payload === "object") {
      const p = payload as Record<string, unknown>;
      const rainId = String(p.rainId ?? p.id ?? "");
      if (rainId && /AmountUpdated/i.test(canonical) && typeof p.amount === "number") {
        return `${canonical}:${rainId}:${p.amount}`;
      }
      if (rainId) return `${canonical}:${rainId}`;
      const reqId = p.reqId ?? p.ReqId;
      if (typeof reqId === "string" && reqId) return `${canonical}:${reqId}`;
    }
    if (typeof payload === "string") {
      return `${canonical}:${payload.slice(0, 96)}`;
    }
    try {
      return `${canonical}:${JSON.stringify(payload).slice(0, 120)}`;
    } catch {
      return `${canonical}:unknown`;
    }
  }

  private shouldSkipDuplicate(canonical: string, payload: unknown): boolean {
    const key = this.eventDedupeKey(canonical, payload);
    const now = Date.now();
    const prev = this.recentEventKeys.get(key);
    if (prev != null && now - prev < HUB_EVENT_DEDUPE_MS) return true;
    this.recentEventKeys.set(key, now);
    if (this.recentEventKeys.size > 400) {
      for (const [k, t] of this.recentEventKeys) {
        if (now - t > 10_000) this.recentEventKeys.delete(k);
      }
    }
    return false;
  }

  private dispatchEvent(canonical: string, payload: unknown, handler?: (payload: unknown) => void): void {
    if (this.shouldSkipDuplicate(canonical, payload)) return;
    handler?.(payload);
    for (const fn of this.listeners.get(canonical) ?? []) {
      fn(payload);
    }
  }

  private bindEvent(canonical: string, handler?: (payload: unknown) => void): void {
    if (!this.connection) return;
    for (const name of hubEventVariants(canonical)) {
      if (this.boundEvents.has(name)) continue;
      this.boundEvents.add(name);
      this.connection.on(name, (payload: unknown) => {
        this.dispatchEvent(canonical, payload, handler);
      });
    }
  }

  on(event: string, fn: (payload: unknown) => void): () => void {
    if (!this.listeners.has(event)) this.listeners.set(event, new Set());
    this.listeners.get(event)!.add(fn);
    this.bindEvent(event);
    return () => this.listeners.get(event)?.delete(fn);
  }

  async subscribeRain(): Promise<void> {
    await this.ensureConnected();
    await this.connection!.invoke(SIGNALR.rain.subscribe);
  }

  async joinRain(payload: { reqId: string; rainId: string; captchaToken?: string | null }): Promise<void> {
    await this.ensureConnected();
    await this.connection!.invoke(SIGNALR.rain.join, payload);
  }

  async playLimbo(payload: {
    reqId: string;
    amount: number;
    currency: string;
    multiplier: number;
  }): Promise<void> {
    await this.ensureConnected();
    await this.connection!.invoke(SIGNALR.limbo.play, payload);
  }

  async subscribeCaseUnboxing(): Promise<void> {
    await this.ensureConnected();
    await this.connection!.invoke(SIGNALR.caseUnboxing.subscribe);
  }

  async playCaseUnboxing(payload: {
    reqId: string;
    caseId: string;
    casesNumber: number;
    currency: string;
    kind: string;
    isFastSpin: boolean;
    rankId?: string | null;
  }): Promise<void> {
    await this.ensureConnected();
    await this.connection!.invoke(SIGNALR.caseUnboxing.play, payload);
  }

  private async ensureConnected(): Promise<void> {
    if (!this.connection || this.connection.state !== HubConnectionState.Connected) {
      await this.connect();
    }
  }
}
