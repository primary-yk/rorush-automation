import crypto from "node:crypto";
import { loadConfig } from "../config.js";

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

export function licenseDevSkip(): boolean {
  return !!loadConfig().LICENSE_DEV_SKIP;
}
