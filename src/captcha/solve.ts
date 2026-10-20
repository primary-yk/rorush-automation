import { fetch } from "undici";
import { captchaApiKey, loadConfig, reloadEnv } from "../config.js";

export type CaptchaKind = "hcaptcha" | "turnstile";
export type CaptchaProvider = "2captcha" | "capsolver";

const DEFAULT_HCAPTCHA_SITEKEY = "d5eed048-d092-4296-8496-a040aaccc710";
const PAGE_URL = process.env.RORUSH_SITE_URL ?? "https://rorush.com/";

type CreateResult = { taskId?: number | string; errorCode?: string; errorDescription?: string };
type PollResult = {
  status?: string;
  errorCode?: string;
  errorDescription?: string;
  solution?: { gRecaptchaResponse?: string; token?: string };
};

function siteKey(kind: CaptchaKind): string {
  if (kind === "hcaptcha") {
    return process.env.RORUSH_HCAPTCHA_SITEKEY ?? DEFAULT_HCAPTCHA_SITEKEY;
  }
  const k = process.env.RORUSH_TURNSTILE_SITEKEY ?? "";
  if (!k) throw new Error("Set RORUSH_TURNSTILE_SITEKEY for Turnstile.");
  return k;
}

function providerFromEnv(): CaptchaProvider | "auto" {
  const raw = (loadConfig().CAPTCHA_PROVIDER ?? "2captcha").trim().toLowerCase();
  if (raw === "2captcha" || raw === "twocaptcha") return "2captcha";
  if (raw === "capsolver") return "capsolver";
  return "auto";
}

function isTransientNetworkError(err: unknown): boolean {
  const msg = err instanceof Error ? err.message : String(err);
  return /fetch failed|ECONNRESET|ETIMEDOUT|ENOTFOUND|ECONNREFUSED|socket|network|abort/i.test(msg);
}

async function postJson(url: string, body: unknown, attempt = 1): Promise<unknown> {
  const maxAttempts = Math.max(1, Number(process.env.CAPTCHA_HTTP_RETRIES ?? 4) || 4);
  const timeoutMs = Math.max(5_000, Number(process.env.CAPTCHA_HTTP_TIMEOUT_MS ?? 30_000) || 30_000);
  try {
    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(timeoutMs),
    });
    return res.json();
  } catch (err) {
    if (attempt < maxAttempts && isTransientNetworkError(err)) {
      const delay = Math.min(8000, 500 * 2 ** (attempt - 1));
      await new Promise((r) => setTimeout(r, delay));
      return postJson(url, body, attempt + 1);
    }
    const hint = isTransientNetworkError(err)
      ? " (network — check WSL internet / VPN / firewall; captcha API will retry on next rain)"
      : "";
    throw new Error(`${err instanceof Error ? err.message : String(err)}${hint}`);
  }
}

export async function detectCaptchaProvider(clientKey: string): Promise<CaptchaProvider | null> {
  const probes: Array<{ provider: CaptchaProvider; url: string }> = [
    { provider: "2captcha", url: "https://api.2captcha.com/getBalance" },
    { provider: "capsolver", url: "https://api.capsolver.com/getBalance" },
  ];
  for (const p of probes) {
    try {
      const json = (await postJson(p.url, { clientKey })) as {
        errorCode?: string;
        errorId?: number;
        balance?: number;
      };
      if (json.errorCode === "ERROR_KEY_DOES_NOT_EXIST") continue;
      if (json.errorCode === "ERROR_WRONG_USER_KEY") continue;
      if (json.errorId === 1 && json.errorCode?.includes("KEY")) continue;
      return p.provider;
    } catch {
      continue;
    }
  }
  return null;
}

function buildTask(provider: CaptchaProvider, kind: CaptchaKind, websiteKey: string) {
  const websiteURL = PAGE_URL;
  if (kind === "hcaptcha") {
    if (provider === "capsolver") {
      return { type: "HCaptchaTaskProxyLess", websiteURL, websiteKey };
    }
    return {
      type: "HCaptchaTaskProxyless",
      websiteURL,
      websiteKey,
      fallbackToActualUA: true,
    };
  }
  if (provider === "capsolver") {
    return { type: "AntiTurnstileTaskProxyLess", websiteURL, websiteKey };
  }
  return { type: "TurnstileTaskProxyless", websiteURL, websiteKey };
}

function createUrl(provider: CaptchaProvider): string {
  return provider === "capsolver"
    ? "https://api.capsolver.com/createTask"
    : "https://api.2captcha.com/createTask";
}

function resultUrl(provider: CaptchaProvider): string {
  return provider === "capsolver"
    ? "https://api.capsolver.com/getTaskResult"
    : "https://api.2captcha.com/getTaskResult";
}

function providerHint(provider: CaptchaProvider): string {
  return provider === "capsolver"
    ? "capsolver.com API key → CAPTCHA_PROVIDER=capsolver in .env"
    : "2captcha.com API key → CAPTCHA_PROVIDER=2captcha in .env";
}

async function createAndPoll(
  provider: CaptchaProvider,
  clientKey: string,
  kind: CaptchaKind,
): Promise<string | null> {
  const websiteKey = siteKey(kind);
  const task = buildTask(provider, kind, websiteKey);
  const createJson = (await postJson(createUrl(provider), { clientKey, task })) as CreateResult;

  if (!createJson.taskId) {
    const desc = createJson.errorDescription ?? "createTask failed";
    throw new Error(`${desc}\n\nUse ${providerHint(provider)}`);
  }

  const pollMs = Math.max(800, Number(process.env.CAPTCHA_POLL_MS ?? 1500) || 1500);
  for (let i = 0; i < 60; i++) {
    if (i > 0) {
      await new Promise((r) => setTimeout(r, pollMs));
    }
    const resultJson = (await postJson(resultUrl(provider), {
      clientKey,
      taskId: createJson.taskId,
    })) as PollResult;
    if (resultJson.status === "ready") {
      return resultJson.solution?.gRecaptchaResponse ?? resultJson.solution?.token ?? null;
    }
    if (resultJson.errorDescription) {
      throw new Error(resultJson.errorDescription);
    }
  }
  throw new Error("Captcha solve timed out");
}

let cachedProvider: CaptchaProvider | null = null;

export async function resolveCaptchaProvider(
  clientKey: string,
  _kind: CaptchaKind = "hcaptcha",
): Promise<CaptchaProvider> {
  const forced = providerFromEnv();
  if (forced !== "auto") return forced;
  if (cachedProvider) return cachedProvider;
  const detected = await detectCaptchaProvider(clientKey);
  if (detected) {
    cachedProvider = detected;
    return detected;
  }
  cachedProvider = "2captcha";
  return "2captcha";
}

export async function solveCaptcha(kind: CaptchaKind): Promise<string | null> {
  reloadEnv();
  const clientKey = captchaApiKey();
  if (!clientKey) return null;

  const provider = await resolveCaptchaProvider(clientKey, kind);
  try {
    return await createAndPoll(provider, clientKey, kind);
  } catch (firstErr) {
    const forced = providerFromEnv();
    if (forced !== "auto") throw firstErr;
    const others: CaptchaProvider[] = (["2captcha", "capsolver"] as const).filter(
      (p) => p !== provider,
    );
    for (const alt of others) {
      try {
        cachedProvider = alt;
        return await createAndPoll(alt, clientKey, kind);
      } catch {
        continue;
      }
    }
    throw firstErr;
  }
}

export { isTransientNetworkError };
