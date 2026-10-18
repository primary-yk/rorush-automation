import { encryptField, decryptField } from "../accounts/session-manager.js";
import { getSettings, updateSettings } from "../db/repositories.js";
import { reloadEnv } from "../config.js";
import { licenseDevSkip, parseLicenseKey, type LicensePayload } from "./verify.js";

export type LicenseStatus = {
  active: boolean;
  devSkip: boolean;
  plan: string | null;
  licenseId: string | null;
  expiresAt: string | null;
  message: string | null;
};

function maskId(id: string): string {
  if (id.length <= 6) return "••••••";
  return `${id.slice(0, 3)}…${id.slice(-3)}`;
}

function readStoredPayload(): LicensePayload | null {
  const s = getSettings();
  if (!s.license_payload_json) return null;
  try {
    return JSON.parse(s.license_payload_json) as LicensePayload;
  } catch {
    return null;
  }
}

export function getLicenseStatus(): LicenseStatus {
  reloadEnv();
  if (licenseDevSkip()) {
    return {
      active: true,
      devSkip: true,
      plan: "developer",
      licenseId: null,
      expiresAt: null,
      message: null,
    };
  }

  const s = getSettings();
  if (!s.license_key_enc) {
    return {
      active: false,
      devSkip: false,
      plan: null,
      licenseId: null,
      expiresAt: null,
      message: "Enter a license key to unlock automation.",
    };
  }

  try {
    const key = decryptField(s.license_key_enc);
    if (!key) throw new Error("License missing.");
    const { payload } = parseLicenseKey(key);
    return {
      active: true,
      devSkip: false,
      plan: payload.plan,
      licenseId: maskId(payload.id),
      expiresAt: new Date(payload.exp * 1000).toISOString(),
      message: null,
    };
  } catch (err) {
    return {
      active: false,
      devSkip: false,
      plan: null,
      licenseId: null,
      expiresAt: null,
      message: err instanceof Error ? err.message : String(err),
    };
  }
}

export function isLicenseActive(): boolean {
  return true;
}

export function activateLicense(key: string): LicenseStatus {
  const { payload, raw } = parseLicenseKey(key);
  updateSettings({
    license_key_enc: encryptField(raw),
    license_payload_json: JSON.stringify(payload),
    license_id: payload.id,
    license_plan: payload.plan,
    license_exp: payload.exp,
  });
  return getLicenseStatus();
}

export function clearLicense(): void {
  updateSettings({
    license_key_enc: null,
    license_payload_json: null,
    license_id: null,
    license_plan: null,
    license_exp: null,
  });
}

/** Raw license string for bot relay auth (local only). */
export function getStoredLicenseKey(): string | null {
  if (licenseDevSkip()) return null;
  const s = getSettings();
  if (!s.license_key_enc) return null;
  try {
    return decryptField(s.license_key_enc);
  } catch {
    return null;
  }
}

export function revalidateStoredLicense(): void {
  const payload = readStoredPayload();
  if (!payload) return;
  if (payload.exp * 1000 < Date.now()) {
    clearLicense();
  }
}
