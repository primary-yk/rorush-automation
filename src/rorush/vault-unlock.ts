/** Parse RoRush vault lock / info unlock timestamp from assorted API shapes. */

function epochMsFromUnknown(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) {
    if (value >= 1_000_000_000_000) return Math.round(value);
    if (value >= 1_000_000_000 && value < 10_000_000_000) return Math.round(value * 1000);
    return null;
  }
  if (typeof value === "string") {
    const t = value.trim();
    if (/^\d+$/.test(t)) {
      return epochMsFromUnknown(Number(t));
    }
    const parsed = Date.parse(t);
    if (!Number.isNaN(parsed)) return parsed;
  }
  return null;
}

function unwrapPayload(record: Record<string, unknown>): unknown {
  if ("data" in record && record.data !== undefined) return record.data;
  if ("result" in record && record.result !== undefined) return record.result;
  return record;
}

/** Lock endpoint often returns the unlock ISO string as the entire JSON body (see rorush.com client). */
export function parseVaultUnlockAt(body: unknown): string | null {
  const epoch = epochMsFromUnknown(body);
  if (epoch != null) return new Date(epoch).toISOString();

  if (typeof body === "string") {
    const t = body.trim();
    if (!t) return null;
    return t;
  }
  if (!body || typeof body !== "object") return null;

  const record = body as Record<string, unknown>;
  for (const key of [
    "unlockAt",
    "lockedUntil",
    "unlockTime",
    "vaultUnlockAt",
    "lockExpiresAt",
    "vaultLockedUntil",
  ] as const) {
    if (record[key] !== undefined && record[key] !== null) {
      const parsed = parseVaultUnlockAt(record[key]);
      if (parsed) return parsed;
    }
  }

  const inner = unwrapPayload(record);
  if (inner !== record) {
    const fromInner = parseVaultUnlockAt(inner);
    if (fromInner) return fromInner;
  }

  return null;
}

/** True when the JSON body is a bare balance (cents), not a vault info object. */
export function isBareBalanceCentsBody(body: unknown): body is number {
  return typeof body === "number" && Number.isFinite(body) && body >= 0 && body < 1_000_000_000;
}

export function extractRoRushErrorMessage(body: unknown): string | null {
  if (!body || typeof body !== "object") return null;
  const r = body as Record<string, unknown>;
  for (const key of ["message", "error", "title", "detail"] as const) {
    const v = r[key];
    if (typeof v === "string" && v.trim()) return v.trim();
  }
  return null;
}
