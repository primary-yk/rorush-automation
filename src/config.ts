import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { z } from "zod";
import { loadProjectEnv } from "./bootstrap-env.js";

const PROJECT_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

export function projectRoot(): string {
  return PROJECT_ROOT;
}

/** RoRush: multipliers below ~1.3× can leave wager lock; enforce on all limbo bets. */
export const LIMBO_MIN_MULTIPLIER = 1.3;

export function clampLimboMultiplier(multiplier: number): number {
  const n = Number(multiplier);
  if (!Number.isFinite(n)) return LIMBO_MIN_MULTIPLIER;
  return Math.max(LIMBO_MIN_MULTIPLIER, n);
}

/** RoRush limbo minimum wager (5 coins); double/upgrader are separate games. */
export const LIMBO_MIN_BET_COINS = 5;

/** Site floor; `LIMBO_MIN_BET_CENTS` can only raise this, not go below 5 coins. */
export function effectiveLimboMinBetCoins(): number {
  const envBetCents = Number(process.env.LIMBO_MIN_BET_CENTS ?? NaN);
  if (Number.isFinite(envBetCents) && envBetCents > 0) {
    return Math.max(LIMBO_MIN_BET_COINS, envBetCents / 100);
  }
  return LIMBO_MIN_BET_COINS;
}

export function clampLimboBetCoins(betCoins: number): number {
  const n = Number(betCoins);
  if (!Number.isFinite(n)) return LIMBO_MIN_BET_COINS;
  return Math.max(effectiveLimboMinBetCoins(), n);
}

function loadDotenv(): void {
  loadProjectEnv();
}

loadDotenv();

/** Strip quotes, spaces, accidental `clientKey=` prefix from pasted API keys. */
export function normalizeCaptchaApiKey(raw: unknown): string | undefined {
  if (raw === undefined || raw === null || raw === "") return undefined;
  let t = String(raw).trim();
  if (
    (t.startsWith('"') && t.endsWith('"')) ||
    (t.startsWith("'") && t.endsWith("'"))
  ) {
    t = t.slice(1, -1).trim();
  }
  t = t.replace(/\s+/g, "");
  if (/^clientkey=/i.test(t)) {
    t = t.replace(/^clientkey=/i, "");
  }
  return t.length ? t : undefined;
}

const envSchema = z.object({
  ENCRYPTION_KEY: z.string().min(1).optional(),
  RORUSH_API_BASE: z.string().url().default("https://api.rorush.com"),
  RORUSH_SEC_RUSH: z.string().default("836457212"),
  RORUSH_PROXY_URL: z.string().optional(),
  CAPTCHA_PROVIDER: z
    .preprocess((v) => {
      const s = String(v ?? "2captcha")
        .trim()
        .toLowerCase();
      if (s === "capmonster") return "2captcha";
      if (s === "twocaptcha") return "2captcha";
      return s || "2captcha";
    }, z.enum(["auto", "2captcha", "capsolver"]))
    .optional()
    .default("2captcha"),
  /** 2Captcha or CapSolver key (RoRush rain hCaptcha). */
  CAPTCHA_API_KEY: z.preprocess(normalizeCaptchaApiKey, z.string().optional()),
  /** Legacy alias — same as CAPTCHA_API_KEY if that is unset (dcd081d-era .env). */
  CAPMONSTER_API_KEY: z.preprocess(normalizeCaptchaApiKey, z.string().optional()),
  AUTOMATION_API_HOST: z.string().default("127.0.0.1"),
  AUTOMATION_API_PORT: z.coerce.number().int().positive().default(43124),
  REQUEST_MIN_INTERVAL_MS: z.coerce.number().int().positive().default(350),
  MAX_REQUEST_FAILURES: z.coerce.number().int().positive().default(3),
  DATABASE_PATH: z.string().default("./data/rorush-automation.db"),
  LICENSE_PUBLIC_KEY: z.string().optional(),
  LICENSE_DEV_SKIP: z.preprocess((v) => {
    if (v === undefined || v === null || v === "") return false;
    const s = String(v).trim().toLowerCase();
    return s === "1" || s === "true" || s === "yes" || s === "on";
  }, z.boolean()),
});

export type AppConfig = z.infer<typeof envSchema>;

let cached: AppConfig | null = null;

export function reloadEnv(): void {
  loadProjectEnv();
  cached = null;
}

export function captchaApiKey(cfg: AppConfig = loadConfig()): string | undefined {
  return cfg.CAPTCHA_API_KEY ?? cfg.CAPMONSTER_API_KEY;
}

export function loadConfig(): AppConfig {
  if (!cached) {
    const raw = envSchema.parse(process.env);
    const DATABASE_PATH = path.isAbsolute(raw.DATABASE_PATH)
      ? raw.DATABASE_PATH
      : path.resolve(PROJECT_ROOT, raw.DATABASE_PATH);
    cached = { ...raw, DATABASE_PATH };
  }
  return cached;
}

export function encryptionKeyStatus(): { ok: true } | { ok: false; reason: string } {
  reloadEnv();
  const keyB64 = loadConfig().ENCRYPTION_KEY?.trim();
  if (!keyB64) {
    return {
      ok: false,
      reason: `ENCRYPTION_KEY missing in ${path.join(PROJECT_ROOT, ".env")}`,
    };
  }
  const key = Buffer.from(keyB64, "base64");
  if (key.length !== 32) {
    return {
      ok: false,
      reason: `ENCRYPTION_KEY must decode to 32 bytes (got ${key.length}) — run: openssl rand -base64 32`,
    };
  }
  return { ok: true };
}

export function botRuntimeLabel(): string {
  return `${PROJECT_ROOT} · ${os.hostname()}`;
}

export function requireEncryptionKey(): Buffer {
  const status = encryptionKeyStatus();
  if (!status.ok) {
    const where = botRuntimeLabel();
    throw new Error(
      `${status.reason}. This bot process: ${where}. ` +
        "If your PC doctor shows ENCRYPTION_KEY OK but Discord shows a different folder (e.g. /workspace), " +
        "another copy of the bot is online with the same DISCORD_BOT_TOKEN — reset the token in the Discord Developer Portal and put the new token only in your PC .env, then restart dev there.",
    );
  }
  const keyB64 = loadConfig().ENCRYPTION_KEY!.trim();
  return Buffer.from(keyB64, "base64");
}
