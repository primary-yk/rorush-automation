import { captchaApiKey, loadConfig } from "../config.js";
import { verifyCaptchaKey } from "./solve.js";

export type CaptchaBalanceSnapshot = {
  configured: boolean;
  provider: string | null;
  balanceUsd: number | null;
  lowBalance: boolean;
  lowBalanceThresholdUsd: number;
  checkedAtMs: number | null;
  error: string | null;
};

let cached: CaptchaBalanceSnapshot | null = null;
let lastFetchMs = 0;

function lowThresholdUsd(): number {
  return Math.max(0.25, Number(process.env.CAPTCHA_LOW_BALANCE_USD ?? 1) || 1);
}

export async function fetchCaptchaBalanceSnapshot(force = false): Promise<CaptchaBalanceSnapshot> {
  const now = Date.now();
  const ttlMs = Math.max(30_000, Number(process.env.CAPTCHA_BALANCE_CACHE_MS ?? 120_000) || 120_000);
  if (!force && cached && now - lastFetchMs < ttlMs) return cached;

  const cfg = loadConfig();
  const key = captchaApiKey(cfg);
  if (!key) {
    cached = {
      configured: false,
      provider: null,
      balanceUsd: null,
      lowBalance: false,
      lowBalanceThresholdUsd: lowThresholdUsd(),
      checkedAtMs: now,
      error: "CAPTCHA_API_KEY not set",
    };
    lastFetchMs = now;
    return cached;
  }

  const provider = (cfg.CAPTCHA_PROVIDER ?? "nonecap").trim();
  try {
    const result = await verifyCaptchaKey(key);
    if (!result.ok) {
      cached = {
        configured: true,
        provider,
        balanceUsd: null,
        lowBalance: false,
        lowBalanceThresholdUsd: lowThresholdUsd(),
        checkedAtMs: now,
        error: result.errorDescription ?? result.errorCode ?? "Balance check failed",
      };
    } else {
      const raw = result.balance ?? null;
      const estimateUsd =
        Math.max(0.0001, Number(process.env.CAPTCHA_ESTIMATE_USD ?? 0.003) || 0.003);
      const balUsd =
        raw != null
          ? result.balanceUnit === "credits"
            ? raw * estimateUsd
            : raw
          : null;
      cached = {
        configured: true,
        provider,
        balanceUsd: balUsd,
        lowBalance: balUsd != null && balUsd < lowThresholdUsd(),
        lowBalanceThresholdUsd: lowThresholdUsd(),
        checkedAtMs: now,
        error: null,
      };
    }
  } catch (err) {
    cached = {
      configured: true,
      provider,
      balanceUsd: null,
      lowBalance: false,
      lowBalanceThresholdUsd: lowThresholdUsd(),
      checkedAtMs: now,
      error: err instanceof Error ? err.message : String(err),
    };
  }
  lastFetchMs = now;
  return cached;
}
