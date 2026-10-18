import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

/** Repo root `.env` (works even when `process.cwd()` is wrong). */
export function rootEnvPath(): string {
  return path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", ".env");
}

export function envFilePaths(): string[] {
  const paths = [rootEnvPath(), path.join(process.cwd(), ".env")];
  return [...new Set(paths)];
}

export function readEnvFileValue(name: string): string | null {
  for (const envPath of envFilePaths()) {
    try {
      const text = fs.readFileSync(envPath, "utf8");
      for (const line of text.split(/\r?\n/)) {
        const trimmed = line.trim();
        if (!trimmed || trimmed.startsWith("#")) continue;
        const eq = trimmed.indexOf("=");
        if (eq <= 0) continue;
        const key = trimmed.slice(0, eq).trim();
        if (key !== name) continue;
        let val = trimmed.slice(eq + 1).trim();
        if (
          (val.startsWith('"') && val.endsWith('"')) ||
          (val.startsWith("'") && val.endsWith("'"))
        ) {
          val = val.slice(1, -1);
        }
        return val;
      }
    } catch {
      /* try next path */
    }
  }
  return null;
}

export function envTruthy(name: string): boolean {
  const fromFile = readEnvFileValue(name);
  const raw = fromFile ?? process.env[name];
  if (raw == null || raw === "") return false;
  const s = raw.trim().toLowerCase();
  return s === "1" || s === "true" || s === "yes" || s === "on";
}

export function licenseDevSkipEnabled(): boolean {
  return (
    envTruthy("LICENSE_DEV_SKIP") ||
    envTruthy("_LICENSE_DEV_SKIP") ||
    envTruthy("RUSH_PILOT_DEV") ||
    envTruthy("DEV_SKIP_LICENSE")
  );
}
