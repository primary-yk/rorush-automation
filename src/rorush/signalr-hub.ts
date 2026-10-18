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

export class RoRushHub {
  private connection: HubConnection | null = null;
  private readonly listeners = new Map<string, Set<(payload: unknown) => void>>();

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

  async connect(): Promise<void> {
    if (this.connection?.state === HubConnectionState.Connected) return;

    const builder = new HubConnectionBuilder()
      .withUrl(this.hubUrl(), {
        accessTokenFactory: () => this.creds.jwt,
        withCredentials: true,
        skipNegotiation: true,
        transport: 1,
      })
      .withAutomaticReconnect()
      .configureLogging(LogLevel.Warning);

    this.connection = builder.build();
    this.wireEvents();
    await this.connection.start();
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
  }

  private wireEvents(): void {
    if (!this.connection) return;
    const c = this.connection;

    const bind = (event: string, handler?: (payload: unknown) => void) => {
      c.on(event, (payload: unknown) => {
        handler?.(payload);
        for (const fn of this.listeners.get(event) ?? []) {
          fn(payload);
        }
      });
    };

    bind(SIGNALR.rain.receiveCreated, this.handlers.onRainCreated);
    bind(SIGNALR.rain.receiveFailure, (p) =>
      this.handlers.onRainFailure?.(p as { message?: string; reqId?: string }),
    );
    bind(SIGNALR.rain.receiveJoinSuccess, (p) =>
      this.handlers.onRainJoinSuccess?.(p as { reqId?: string }),
    );
    bind(SIGNALR.rain.receiveCurrent, this.handlers.onCurrentRains);
    bind(SIGNALR.limbo.receiveResult, this.handlers.onLimboResult);
    bind(SIGNALR.limbo.receiveFailure, (p) =>
      this.handlers.onLimboFailure?.(p as { message?: string }),
    );
    bind(SIGNALR.caseUnboxing.receiveResult, this.handlers.onCaseResult);
    bind(SIGNALR.caseUnboxing.receiveFailure, (p) =>
      this.handlers.onCaseFailure?.(p as { message?: string }),
    );
  }

  on(event: string, fn: (payload: unknown) => void): () => void {
    if (!this.listeners.has(event)) this.listeners.set(event, new Set());
    this.listeners.get(event)!.add(fn);
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
