import dotenv from "dotenv";
import { z } from "zod";

dotenv.config();

const envSchema = z.object({
  ENCRYPTION_KEY: z.string().min(1).optional(),
  RORUSH_API_BASE: z.string().url().default("https://api.rorush.com"),
  RORUSH_SEC_RUSH: z.string().default("836457212"),
  RORUSH_PROXY_URL: z.string().optional(),
  CAPMONSTER_API_KEY: z.string().optional(),
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

export function loadConfig(): AppConfig {
  if (!cached) {
    cached = envSchema.parse(process.env);
  }
  return cached;
}

export function requireEncryptionKey(): Buffer {
  const keyB64 = loadConfig().ENCRYPTION_KEY;
  if (!keyB64) {
    throw new Error("ENCRYPTION_KEY is required in .env (32-byte base64 key).");
  }
  const key = Buffer.from(keyB64, "base64");
  if (key.length !== 32) {
    throw new Error("ENCRYPTION_KEY must decode to exactly 32 bytes.");
  }
  return key;
}
