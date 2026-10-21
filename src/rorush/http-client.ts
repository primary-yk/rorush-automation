import { ProxyAgent, fetch, type RequestInit } from "undici";
import { loadConfig } from "../config.js";
import { RateLimiter } from "../util/rate-limiter.js";
import { withBackoff, GiveUpError } from "../util/retry.js";
import { RORUSH_PATHS } from "./endpoints.js";
import type { ApiErrorBody, LoginEmailResponse } from "./types.js";

export type RoRushCredentials = {
  jwt: string;
  apiKey?: string | null;
};

export class RoRushHttpClient {
  private readonly limiter: RateLimiter;
  private readonly dispatcher = loadConfig().RORUSH_PROXY_URL
    ? new ProxyAgent(loadConfig().RORUSH_PROXY_URL!)
    : undefined;

  constructor(
    private readonly creds: RoRushCredentials,
    private readonly accountProxyUrl?: string | null,
  ) {
    this.limiter = new RateLimiter(loadConfig().REQUEST_MIN_INTERVAL_MS);
  }

  private getDispatcher() {
    if (this.accountProxyUrl) {
      return new ProxyAgent(this.accountProxyUrl);
    }
    return this.dispatcher;
  }

  async request<T>(
    path: string,
    init: RequestInit & { skipAuth?: boolean; timeoutMs?: number } = {},
  ): Promise<T> {
    const cfg = loadConfig();
    await this.limiter.waitTurn();
    const url = path.startsWith("http") ? path : `${cfg.RORUSH_API_BASE}${path}`;
    const headers: Record<string, string> = {
      Accept: "application/json",
      "Content-Type": "application/json",
      "x-sec-rush": cfg.RORUSH_SEC_RUSH,
      ...(init.headers as Record<string, string>),
    };
    if (!init.skipAuth && this.creds.jwt) {
      headers.Authorization = `Bearer ${this.creds.jwt}`;
    }
    if (this.creds.apiKey) {
      headers["x-api-key"] = this.creds.apiKey;
    }

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), init.timeoutMs ?? 25_000);

    try {
      const res = await withBackoff(
        async () => {
          const response = await fetch(url, {
            ...init,
            headers,
            signal: controller.signal,
            dispatcher: this.getDispatcher(),
          });
          if (response.status >= 500) {
            throw new Error(`RoRush HTTP ${response.status}`);
          }
          return response;
        },
        { maxAttempts: loadConfig().MAX_REQUEST_FAILURES },
      );

      const text = await res.text();
      let data: T;
      try {
        data = text ? (JSON.parse(text) as T) : ({} as T);
      } catch {
        data = {} as T;
      }
      if (!res.ok) {
        const errBody = data as ApiErrorBody & { error?: string; title?: string };
        const detail =
          errBody.message?.trim() ||
          errBody.error?.trim() ||
          errBody.title?.trim() ||
          (text.length > 0 && text.length < 280 ? text : "");
        throw new Error(detail || `RoRush HTTP ${res.status}`);
      }
      return data;
    } catch (err) {
      if (err instanceof GiveUpError) {
        throw new Error(err.message);
      }
      throw err;
    } finally {
      clearTimeout(timeout);
    }
  }

  async loginEmail(email: string, password: string): Promise<LoginEmailResponse> {
    return this.request<LoginEmailResponse>(RORUSH_PATHS.auth.loginEmail, {
      method: "POST",
      body: JSON.stringify({ email, password }),
      skipAuth: true,
    });
  }

  async loginCookie(cookie: string): Promise<LoginEmailResponse> {
    return this.request<LoginEmailResponse>(RORUSH_PATHS.auth.loginCookie, {
      method: "POST",
      body: JSON.stringify({ cookie }),
      skipAuth: true,
    });
  }

  async authStatus(): Promise<{ authenticated?: boolean }> {
    return this.request(RORUSH_PATHS.auth.status);
  }

  /** RoRush requires `?currency=crypto|robux`; response is usually a numeric balance in cents. */
  async getBalance(currency: "crypto" | "robux" = "crypto"): Promise<unknown> {
    const q = encodeURIComponent(currency);
    return this.request(`${RORUSH_PATHS.user.balance}?currency=${q}`);
  }

  async getLevel(): Promise<unknown> {
    return this.request(RORUSH_PATHS.user.level);
  }

  async getDailyCasesInfo(): Promise<unknown> {
    return this.request(RORUSH_PATHS.rewards.dailyCasesInfo);
  }

  async getEnergyCasesInfo(): Promise<{ cases?: Array<Record<string, unknown>> }> {
    return this.request(RORUSH_PATHS.rewards.energyCasesInfo);
  }

  async getSeasonCasesCurrent(): Promise<unknown> {
    return this.request(RORUSH_PATHS.rewards.seasonsCasesCurrent);
  }

  async redeemFlashcode(code: string, turnstileToken?: string | null): Promise<unknown> {
    return this.request(RORUSH_PATHS.rewards.flashcodeUse, {
      method: "POST",
      body: JSON.stringify({ code, turnstileToken: turnstileToken ?? null }),
    });
  }
}
