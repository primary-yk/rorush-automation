import { fetch } from "undici";
import { captchaApiKey, loadConfig, reloadEnv } from "../config.js";

export type CaptchaKind = "hcaptcha" | "turnstile";
export type CaptchaProvider = "2captcha" | "capsolver";

const DEFAULT_HCAPTCHA_SITEKEY = "d5eed048-d092-4296-8496-a040aaccc710";
const PAGE_URL = process.env.RORUSH_SITE_URL ?? "https://rorush.com/";

type CreateResult = {
  errorId?: number;
  taskId?: number | string;
  errorCode?: string;
  errorDescription?: string;
};
type PollResult = {
  errorId?: number;
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

function isJsonParseError(err: unknown): boolean {
  return err instanceof SyntaxError || /JSON|Unexpected token|non-whitespace character after JSON/i.test(
    err instanceof Error ? err.message : String(err),
  );
}

/** Some proxies/WSL setups prepend junk (e.g. `200 `) before JSON — res.json() then fails at position 4. */
export function parseCaptchaApiBody(text: string, context: string): unknown {
  let s = text.trim();
  if (s.charCodeAt(0) === 0xfeff) s = s.slice(1).trim();
  if (!s) {
    throw new Error(`Empty captcha API response (${context})`);
  }

  const tryParse = (raw: string): unknown | null => {
    try {
      return JSON.parse(raw) as unknown;
    } catch {
      return null;
    }
  };

  let parsed = tryParse(s);
  if (parsed !== null) return parsed;

  const jsonStart = s.search(/[{\[]/);
  if (jsonStart > 0) {
    parsed = tryParse(s.slice(jsonStart));
    if (parsed !== null) return parsed;
  }

  const preview = s.slice(0, 160).replace(/\s+/g, " ");
  throw new Error(
    `Captcha API returned non-JSON (${context}): ${preview}${s.length > 160 ? "…" : ""}`,
  );
}

async function postJson(url: string, body: unknown, attempt = 1): Promise<unknown> {
  const maxAttempts = Math.max(1, Number(process.env.CAPTCHA_HTTP_RETRIES ?? 4) || 4);
  const timeoutMs = Math.max(5_000, Number(process.env.CAPTCHA_HTTP_TIMEOUT_MS ?? 30_000) || 30_000);
  try {
    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json", Accept: "application/json" },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(timeoutMs),
    });
    const text = await res.text();
    const json = parseCaptchaApiBody(text, url);
    if (!res.ok) {
      throw new Error(`HTTP ${res.status} from captcha API (${url})`);
    }
    return json;
  } catch (err) {
    if (attempt < maxAttempts && (isTransientNetworkError(err) || isJsonParseError(err))) {
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

function cancelUrl(provider: CaptchaProvider): string {
  return provider === "capsolver"
    ? "https://api.capsolver.com/cancelTask"
    : "https://api.2captcha.com/cancelTask";
}

async function cancelCaptchaTask(
  provider: CaptchaProvider,
  clientKey: string,
  taskId: number | string,
): Promise<void> {
  try {
    await postJson(cancelUrl(provider), { clientKey: clientKey.trim(), taskId });
  } catch {
    /* best-effort — stale tasks may already be gone */
  }
}

/** Failures where submitting a fresh task often helps (queue stall or worker miss). */
export function isCaptchaRetryableTaskError(err: unknown): boolean {
  const msg = err instanceof Error ? err.message : String(err);
  return (
    /timed out|processing stall|workers could not solve|could not solve the captcha|unsolvable|ERROR_CAPTCHA_UNSOLVABLE/i.test(
      msg,
    ) || isTransientNetworkError(err)
  );
}

export function captchaTaskSummary(kind: CaptchaKind = "hcaptcha"): {
  provider: CaptchaProvider | "auto";
  websiteURL: string;
  websiteKey: string;
  taskType: string;
} {
  const forced = providerFromEnv();
  const provider: CaptchaProvider | "auto" = forced === "auto" ? "auto" : forced;
  const p: CaptchaProvider = provider === "auto" ? "2captcha" : provider;
  const websiteKey = siteKey(kind);
  const task = buildTask(p, kind, websiteKey);
  return {
    provider,
    websiteURL: PAGE_URL,
    websiteKey,
    taskType: String((task as { type?: string }).type ?? "unknown"),
  };
}

function pollFailureMessage(resultJson: PollResult): string | null {
  if (resultJson.errorId != null && resultJson.errorId !== 0) {
    return resultJson.errorDescription ?? resultJson.errorCode ?? "getTaskResult failed";
  }
  const code = resultJson.errorCode?.trim();
  if (code && !/^(OK|PROCESSING)$/i.test(code)) {
    return resultJson.errorDescription ?? code;
  }
  if (resultJson.errorDescription && !/processing/i.test(resultJson.errorDescription)) {
    return resultJson.errorDescription;
  }
  return null;
}

export type CaptchaSolveOptions = {
  /** Cancel a stuck "processing" task after this many ms and retry with a new task. */
  cancelAfterMs?: number;
  /** How many createTask+poll cycles per solveCaptcha call. */
  taskAttempts?: number;
};

function resolveCancelAfterMs(override?: number): number {
  if (override != null && Number.isFinite(override)) {
    return Math.max(30_000, override);
  }
  return Math.max(
    45_000,
    Number(process.env.CAPTCHA_CANCEL_AFTER_MS ?? 110_000) || 110_000,
  );
}

function resolveTaskAttempts(override?: number): number {
  if (override != null && Number.isFinite(override)) {
    return Math.max(1, Math.trunc(override));
  }
  return Math.max(1, Number(process.env.CAPTCHA_TASK_ATTEMPTS ?? 2) || 2);
}

async function pollTaskUntilReady(
  provider: CaptchaProvider,
  clientKey: string,
  taskId: number | string,
  opts: { attempt: number; attempts: number; cancelAfterMs: number },
): Promise<string> {
  const pollMs = Math.max(400, Number(process.env.CAPTCHA_POLL_MS ?? 500) || 500);
  const maxPolls = Math.max(20, Number(process.env.CAPTCHA_MAX_POLLS ?? 180) || 180);
  const cancelAfterMs = opts.cancelAfterMs;
  const verbose = /^(1|true|yes|on)$/i.test(process.env.CAPTCHA_VERBOSE?.trim() ?? "");
  const started = Date.now();
  let lastStatus = "processing";

  for (let i = 0; i < maxPolls; i++) {
    if (i > 0) {
      await new Promise((r) => setTimeout(r, pollMs));
    }
    const resultJson = (await postJson(resultUrl(provider), {
      clientKey,
      taskId,
    })) as PollResult;

    const failMsg = pollFailureMessage(resultJson);
    if (failMsg) {
      throw new Error(failMsg);
    }

    lastStatus = resultJson.status ?? lastStatus;
    if (resultJson.status === "ready") {
      const token =
        resultJson.solution?.gRecaptchaResponse ?? resultJson.solution?.token ?? null;
      if (!token) {
        throw new Error("Captcha status ready but solution token missing — check sitekey/pageurl");
      }
      return token;
    }

    const elapsed = Date.now() - started;
    if (
      elapsed >= cancelAfterMs &&
      (resultJson.status === "processing" || resultJson.status == null)
    ) {
      await cancelCaptchaTask(provider, clientKey, taskId);
      throw new Error(
        `Captcha processing stall ~${Math.round(elapsed / 1000)}s (status ${lastStatus}) — task cancelled`,
      );
    }

    if (verbose && (i === 0 || i % 5 === 0)) {
      const sec = (elapsed / 1000).toFixed(0);
      console.log(
        `[captcha] poll ${i + 1}/${maxPolls} · ${sec}s · status=${lastStatus} · task ${String(taskId).slice(0, 8)}…` +
          (opts.attempts > 1 ? ` · try ${opts.attempt}/${opts.attempts}` : ""),
      );
    }
  }

  await cancelCaptchaTask(provider, clientKey, taskId);
  const waitedSec = ((Date.now() - started) / 1000).toFixed(0);
  throw new Error(
    `Captcha solve timed out after ~${waitedSec}s (${maxPolls} polls, last status ${lastStatus}). ` +
      "2Captcha queue may be slow — use CAPTCHA_VERBOSE=1, rain dual-start env vars, or a faster hCaptcha provider when integrated. " +
      "Keep npm run dev up during tip stage for prewarm.",
  );
}

async function createAndPollOnceWithOpts(
  provider: CaptchaProvider,
  clientKey: string,
  kind: CaptchaKind,
  attempt: number,
  attempts: number,
  cancelAfterMs: number,
): Promise<string> {
  const websiteKey = siteKey(kind);
  const task = buildTask(provider, kind, websiteKey);
  const clientKeyClean = clientKey.trim();
  if (!clientKeyClean) {
    throw new Error("CAPTCHA_API_KEY is empty after trim — fix .env in ~/rush-pilot");
  }

  const createJson = (await postJson(createUrl(provider), {
    clientKey: clientKeyClean,
    task,
  })) as CreateResult;

  if (createJson.errorId != null && createJson.errorId !== 0) {
    const desc =
      createJson.errorDescription ??
      createJson.errorCode ??
      "createTask rejected the API key";
    throw new Error(
      `${desc}\n\n` +
        "Copy the key from 2captcha.com → Settings → API Key (32 hex chars, no quotes). " +
        "In .env use exactly: CAPTCHA_API_KEY=your_key  and CAPTCHA_PROVIDER=2captcha",
    );
  }

  if (!createJson.taskId) {
    const desc = createJson.errorDescription ?? "createTask failed";
    throw new Error(`${desc}\n\nUse ${providerHint(provider)}`);
  }

  if (attempt === 1 || /^(1|true|yes|on)$/i.test(process.env.CAPTCHA_VERBOSE?.trim() ?? "")) {
    console.log(
      `[captcha] task created (${provider}) · ${String((task as { type?: string }).type)} · key ${websiteKey.slice(0, 8)}… · url ${PAGE_URL}` +
        (attempts > 1 ? ` · attempt ${attempt}/${attempts}` : ""),
    );
  }

  return pollTaskUntilReady(provider, clientKeyClean, createJson.taskId, {
    attempt,
    attempts,
    cancelAfterMs,
  });
}

async function createAndPoll(
  provider: CaptchaProvider,
  clientKey: string,
  kind: CaptchaKind,
  solveOpts?: CaptchaSolveOptions,
): Promise<string | null> {
  const attempts = resolveTaskAttempts(solveOpts?.taskAttempts);
  const cancelAfterMs = resolveCancelAfterMs(solveOpts?.cancelAfterMs);
  let lastErr: unknown;
  for (let attempt = 1; attempt <= attempts; attempt++) {
    try {
      return await createAndPollOnceWithOpts(
        provider,
        clientKey,
        kind,
        attempt,
        attempts,
        cancelAfterMs,
      );
    } catch (err) {
      lastErr = err;
      if (attempt < attempts && isCaptchaRetryableTaskError(err)) {
        const why = err instanceof Error ? err.message.split("\n")[0] : String(err);
        console.warn(`[captcha] retrying with new task (${attempt + 1}/${attempts}) after: ${why.slice(0, 100)}`);
        const retryDelayMs = Math.max(
          400,
          Number(process.env.CAPTCHA_RETRY_DELAY_MS ?? 800) || 800,
        );
        await new Promise((r) => setTimeout(r, retryDelayMs));
        continue;
      }
      throw err;
    }
  }
  throw lastErr instanceof Error ? lastErr : new Error(String(lastErr));
}

export async function verify2CaptchaKey(clientKey: string): Promise<{
  ok: boolean;
  balance?: number;
  errorCode?: string;
  errorDescription?: string;
}> {
  const clientKeyClean = clientKey.trim();
  try {
    const json = (await postJson("https://api.2captcha.com/getBalance", {
      clientKey: clientKeyClean,
    })) as {
      errorId?: number;
      errorCode?: string;
      errorDescription?: string;
      balance?: number;
    };
    if (json.errorId != null && json.errorId !== 0) {
      return {
        ok: false,
        errorCode: json.errorCode,
        errorDescription: json.errorDescription ?? json.errorCode,
      };
    }
    if (json.errorCode) {
      return { ok: false, errorCode: json.errorCode, errorDescription: json.errorDescription };
    }
    if (typeof json.balance !== "number") {
      return { ok: false, errorDescription: "Unexpected getBalance response" };
    }
    return { ok: true, balance: json.balance };
  } catch (err) {
    return {
      ok: false,
      errorDescription: err instanceof Error ? err.message : String(err),
    };
  }
}

export async function fetchCaptchaBalance(clientKey: string): Promise<number | null> {
  const v = await verify2CaptchaKey(clientKey);
  return v.ok && v.balance != null ? v.balance : null;
}

export function captchaKeyFingerprint(key: string): string {
  if (key.length <= 10) return "(too short)";
  return `${key.slice(0, 4)}…${key.slice(-4)} (${key.length} chars)`;
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

export async function solveCaptcha(
  kind: CaptchaKind,
  solveOpts?: CaptchaSolveOptions,
): Promise<string | null> {
  reloadEnv();
  const clientKey = captchaApiKey();
  if (!clientKey) return null;

  const provider = await resolveCaptchaProvider(clientKey, kind);
  try {
    return await createAndPoll(provider, clientKey, kind, solveOpts);
  } catch (firstErr) {
    const forced = providerFromEnv();
    if (forced !== "auto") throw firstErr;
    const others: CaptchaProvider[] = (["2captcha", "capsolver"] as const).filter(
      (p) => p !== provider,
    );
    for (const alt of others) {
      try {
        cachedProvider = alt;
        return await createAndPoll(alt, clientKey, kind, solveOpts);
      } catch {
        continue;
      }
    }
    throw firstErr;
  }
}

export { isTransientNetworkError };
