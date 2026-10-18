import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { loadConfig, reloadEnv } from "../config.js";

const ENV_PATH = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..", ".env");

function readEnvFileFlag(name: string): boolean {
  try {
    const text = fs.readFileSync(ENV_PATH, "utf8");
    for (const line of text.split(/\r?\n/)) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith("#")) continue;
      const eq = trimmed.indexOf("=");
      if (eq <= 0) continue;
      if (trimmed.slice(0, eq).trim() !== name) continue;
      const s = trimmed
        .slice(eq + 1)
        .trim()
        .replace(/^["']|["']$/g, "")
        .toLowerCase();
      return s === "1" || s === "true" || s === "yes" || s === "on";
    }
  } catch {
    /* ignore */
  }
  return false;
}

export type LicensePayload = {
  v: 1;
  id: string;
  plan: string;
  exp: number;
};

const PREFIX = "RP1";

function publicKeyPem(): crypto.KeyObject {
  const cfg = loadConfig();
  const raw = cfg.LICENSE_PUBLIC_KEY?.trim();
  if (!raw) {
    throw new Error("LICENSE_PUBLIC_KEY is not configured on this build.");
  }
  const pem = raw.includes("BEGIN PUBLIC KEY")
    ? raw
    : `-----BEGIN PUBLIC KEY-----\n${raw.replace(/\s+/g, "")}\n-----END PUBLIC KEY-----`;
  return crypto.createPublicKey(pem);
}

export function parseLicenseKey(key: string): { payload: LicensePayload; raw: string } {
  const trimmed = key.trim();
  const parts = trimmed.split(".");
  if (parts.length !== 3 || parts[0] !== PREFIX) {
    throw new Error("Invalid license format.");
  }
  const payloadJson = Buffer.from(parts[1]!, "base64url").toString("utf8");
  const payload = JSON.parse(payloadJson) as LicensePayload;
  if (payload.v !== 1 || !payload.id || !payload.exp) {
    throw new Error("Invalid license payload.");
  }
  const data = Buffer.from(`${parts[0]}.${parts[1]}`);
  const sig = Buffer.from(parts[2]!, "base64url");
  const ok = crypto.verify(null, data, publicKeyPem(), sig);
  if (!ok) throw new Error("License signature invalid.");
  if (payload.exp * 1000 < Date.now()) {
    throw new Error("License expired.");
  }
  return { payload, raw: trimmed };
}

function envFlag(name: string): boolean {
  const v = process.env[name];
  if (v == null || v === "") return false;
  const s = v.trim().toLowerCase();
  return s === "1" || s === "true" || s === "yes" || s === "on";
}

export function licenseDevSkip(): boolean {
  reloadEnv();
  if (
    readEnvFileFlag("LICENSE_DEV_SKIP") ||
    readEnvFileFlag("_LICENSE_DEV_SKIP") ||
    readEnvFileFlag("RUSH_PILOT_DEV")
  ) {
    return true;
  }
  if (loadConfig().LICENSE_DEV_SKIP) return true;
  return (
    envFlag("LICENSE_DEV_SKIP") ||
    envFlag("_LICENSE_DEV_SKIP") ||
    envFlag("RUSH_PILOT_DEV") ||
    envFlag("DEV_SKIP_LICENSE")
  );
}
