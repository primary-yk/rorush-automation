import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const PROJECT_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

/** Filenames people accidentally use instead of `.env` (loaded as fallback for missing keys). */
export const ENV_FALLBACK_FILES = ["nano.env", ".env.local"] as const;

function parseEnvLines(text: string): Array<[string, string]> {
  const out: Array<[string, string]> = [];
  for (const line of text.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eq = trimmed.indexOf("=");
    if (eq <= 0) continue;
    const key = trimmed.slice(0, eq).trim();
    let val = trimmed.slice(eq + 1).trim();
    if (
      (val.startsWith('"') && val.endsWith('"')) ||
      (val.startsWith("'") && val.endsWith("'"))
    ) {
      val = val.slice(1, -1);
    }
    if (!key || !val) continue;
    out.push([key, val]);
  }
  return out;
}

function applyEnvFile(
  envPath: string,
  mode: "override" | "missing-only",
): boolean {
  try {
    const text = fs.readFileSync(envPath, "utf8");
    for (const [key, val] of parseEnvLines(text)) {
      if (mode === "missing-only" && process.env[key] !== undefined) continue;
      process.env[key] = val;
    }
    return true;
  } catch {
    return false;
  }
}

/** Load repo `.env` (and common misnamed copies) into process.env before config runs. */
export function loadProjectEnv(): void {
  applyEnvFile(path.join(PROJECT_ROOT, ".env"), "override");
  for (const name of ENV_FALLBACK_FILES) {
    applyEnvFile(path.join(PROJECT_ROOT, name), "missing-only");
  }
}

export function projectEnvRoot(): string {
  return PROJECT_ROOT;
}

loadProjectEnv();
