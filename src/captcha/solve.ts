import { fetch } from "undici";
import { loadConfig, reloadEnv } from "../config.js";

export type CaptchaKind = "hcaptcha" | "turnstile";
export type CaptchaProvider = "capmonster" | "2captcha" | "capsolver";

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
  const raw = (loadConfig().CAPTCHA_PROVIDER ?? "auto").trim().toLowerCase();
  if (raw === "2captcha" || raw === "twocaptcha") return "2captcha";
  if (raw === "capsolver") return "capsolver";
  if (raw === "capmonster") return "capmonster";
  return "auto";
}

async function postJson(url: string, body: unknown): Promise<unknown> {
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  return res.json();
}

export async function detectCaptchaProvider(clientKey: string): Promise<CaptchaProvider | null> {
  const probes: Array<{ provider: CaptchaProvider; url: string }> = [
    { provider: "capmonster", url: "https://api.capmonster.cloud/getBalance" },
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
  switch (provider) {
    case "2captcha":
      return "https://api.2captcha.com/createTask";
    case "capsolver":
      return "https://api.capsolver.com/createTask";
    default:
      return "https://api.capmonster.cloud/createTask";
  }
}

function resultUrl(provider: CaptchaProvider): string {
  switch (provider) {
    case "2captcha":
      return "https://api.2captcha.com/getTaskResult";
    case "capsolver":
      return "https://api.capsolver.com/getTaskResult";
    default:
      return "https://api.capmonster.cloud/getTaskResult";
  }
}

function providerHint(provider: CaptchaProvider): string {
  switch (provider) {
    case "2captcha":
      return "2captcha.com API key → CAPTCHA_PROVIDER=2captcha in .env";
    case "capsolver":
      return "capsolver.com API key → CAPTCHA_PROVIDER=capsolver in .env";
    default:
      return "capmonster.cloud API key → CAPTCHA_PROVIDER=capmonster (default)";
  }
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
    const code = createJson.errorCode ?? "";
    const desc = createJson.errorDescription ?? "createTask failed";
    if (code === "ERROR_TASK_NOT_SUPPORTED" || /task type/i.test(desc)) {
      throw new Error(
        `${desc}\n\nYour key is for ${providerHint(provider)} If you use 2Captcha or CapSolver, set CAPTCHA_PROVIDER in .env.`,
      );
    }
    throw new Error(desc);
  }

  for (let i = 0; i < 40; i++) {
    await new Promise((r) => setTimeout(r, 3000));
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

export async function resolveCaptchaProvider(clientKey: string): Promise<CaptchaProvider> {
  const forced = providerFromEnv();
  if (forced !== "auto") return forced;
  if (cachedProvider) return cachedProvider;
  const detected = await detectCaptchaProvider(clientKey);
  if (detected) {
    cachedProvider = detected;
    return detected;
  }
  return "capmonster";
}

export async function solveCaptcha(kind: CaptchaKind): Promise<string | null> {
  reloadEnv();
  const clientKey = loadConfig().CAPMONSTER_API_KEY;
  if (!clientKey) return null;

  const provider = await resolveCaptchaProvider(clientKey);
  try {
    return await createAndPoll(provider, clientKey, kind);
  } catch (firstErr) {
    const forced = providerFromEnv();
    if (forced !== "auto") throw firstErr;
    const others: CaptchaProvider[] = ["capmonster", "2captcha", "capsolver"].filter(
      (p) => p !== provider,
    ) as CaptchaProvider[];
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
