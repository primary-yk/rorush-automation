import type { LicenseStatus } from "./api";

/** Baked at `next dev` / build from `.env` LICENSE_DEV_SKIP (owner machines only). */
export function ownerDevSkipEnabled(): boolean {
  return process.env.NEXT_PUBLIC_RUSH_PILOT_DEV_SKIP === "true";
}

export function licenseUnlocked(license: LicenseStatus | null | undefined): boolean {
  if (ownerDevSkipEnabled()) return true;
  if (!license) return false;
  return license.active || license.devSkip;
}

export const DEV_LICENSE: LicenseStatus = {
  active: true,
  devSkip: true,
  plan: "developer",
  licenseId: null,
  expiresAt: null,
  message: null,
};
