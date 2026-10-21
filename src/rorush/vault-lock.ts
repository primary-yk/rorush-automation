/** RoRush vault timer options (matches in-site UI). */

export const VAULT_LOCK_PRESETS = {
  "10m": 10,
  "30m": 30,
  "1h": 60,
  "6h": 360,
  "12h": 720,
  "1d": 1440,
} as const;

/** Values RoRush `POST /vault/lock` expects (`duration` field on rorush.com). */
export const VAULT_LOCK_API_DURATION: Record<keyof typeof VAULT_LOCK_PRESETS, string> = {
  "10m": "10min",
  "30m": "30min",
  "1h": "1h",
  "6h": "6h",
  "12h": "12h",
  "1d": "1d",
};

export type VaultLockPresetId = keyof typeof VAULT_LOCK_PRESETS;

export function vaultLockApiDurationFromMinutes(minutes: number): string | null {
  const rounded = Math.round(minutes);
  const hit = (Object.entries(VAULT_LOCK_PRESETS) as Array<[VaultLockPresetId, number]>).find(
    ([, m]) => m === rounded,
  );
  return hit ? VAULT_LOCK_API_DURATION[hit[0]] : null;
}

export function parseVaultLockPreset(raw: string): number | null {
  const t = raw.trim().toLowerCase().replace(/\s+/g, "");
  if (t === "off" || t === "none" || t === "0") return 0;
  const aliases: Record<string, VaultLockPresetId> = {
    "10m": "10m",
    "10min": "10m",
    "10minutes": "10m",
    "30m": "30m",
    "30min": "30m",
    "1h": "1h",
    "1hour": "1h",
    "60m": "1h",
    "6h": "6h",
    "6hours": "6h",
    "12h": "12h",
    "12hours": "12h",
    "1d": "1d",
    "1day": "1d",
    "24h": "1d",
  };
  const id = aliases[t] ?? (t in VAULT_LOCK_PRESETS ? (t as VaultLockPresetId) : null);
  if (!id) return null;
  return VAULT_LOCK_PRESETS[id];
}

export function formatVaultLockPreset(minutes: number): string {
  const hit = Object.entries(VAULT_LOCK_PRESETS).find(([, m]) => m === minutes);
  if (hit) return hit[0];
  if (minutes < 60) return `${minutes}m`;
  if (minutes < 1440) return `${Math.round(minutes / 60)}h`;
  return `${Math.round(minutes / 1440)}d`;
}
