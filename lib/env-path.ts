import fs from "node:fs";
import path from "node:path";

export function projectEnvPath(): string {
  return path.join(process.cwd(), ".env");
}

export function readEnvFileValue(name: string): string | null {
  try {
    const text = fs.readFileSync(projectEnvPath(), "utf8");
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
    /* no .env */
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
