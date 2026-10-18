import { fetch } from "undici";
import { loadConfig } from "../config.js";

export type CaptchaKind = "hcaptcha" | "turnstile";

/** Default from RoRush web client (override via env if they rotate keys). */
const DEFAULT_HCAPTCHA_SITEKEY = "d5eed048-d092-4296-8496-a040aaccc710";
const HCAPTCHA_SITEKEY = process.env.RORUSH_HCAPTCHA_SITEKEY ?? DEFAULT_HCAPTCHA_SITEKEY;
const TURNSTILE_SITEKEY = process.env.RORUSH_TURNSTILE_SITEKEY ?? "";
const PAGE_URL = process.env.RORUSH_SITE_URL ?? "https://rorush.com/";

type CapMonsterTask =
  | {
      type: "HCaptchaTaskProxyless";
      websiteURL: string;
      websiteKey: string;
    }
  | {
      type: "TurnstileTaskProxyless";
      websiteURL: string;
      websiteKey: string;
    };

export async function solveCaptcha(kind: CaptchaKind): Promise<string | null> {
  const apiKey = loadConfig().CAPMONSTER_API_KEY;
  if (!apiKey) return null;

  const websiteKey = kind === "hcaptcha" ? HCAPTCHA_SITEKEY : TURNSTILE_SITEKEY;
  if (!websiteKey) {
    throw new Error(
      `Missing site key env for ${kind}. Set RORUSH_HCAPTCHA_SITEKEY or RORUSH_TURNSTILE_SITEKEY.`,
    );
  }

  const task: CapMonsterTask =
    kind === "hcaptcha"
      ? { type: "HCaptchaTaskProxyless", websiteURL: PAGE_URL, websiteKey }
      : { type: "TurnstileTaskProxyless", websiteURL: PAGE_URL, websiteKey };

  const createRes = await fetch("https://api.capmonster.cloud/createTask", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ clientKey: apiKey, task }),
  });
  const createJson = (await createRes.json()) as { taskId?: number; errorDescription?: string };
  if (!createJson.taskId) {
    throw new Error(createJson.errorDescription ?? "CapMonster createTask failed");
  }

  for (let i = 0; i < 40; i++) {
    await new Promise((r) => setTimeout(r, 3000));
    const resultRes = await fetch("https://api.capmonster.cloud/getTaskResult", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ clientKey: apiKey, taskId: createJson.taskId }),
    });
    const resultJson = (await resultRes.json()) as {
      status?: string;
      solution?: { gRecaptchaResponse?: string; token?: string };
      errorDescription?: string;
    };
    if (resultJson.status === "ready") {
      return resultJson.solution?.gRecaptchaResponse ?? resultJson.solution?.token ?? null;
    }
    if (resultJson.errorDescription) {
      throw new Error(resultJson.errorDescription);
    }
  }
  throw new Error("Captcha solve timed out");
}
