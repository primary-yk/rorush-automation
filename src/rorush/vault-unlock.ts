/** Parse RoRush vault lock / info unlock timestamp from assorted API shapes. */

function unwrapPayload(record: Record<string, unknown>): unknown {
  if ("data" in record && record.data !== undefined) return record.data;
  if ("result" in record && record.result !== undefined) return record.result;
  return record;
}

/** Lock endpoint often returns the unlock ISO string as the entire JSON body (see rorush.com client). */
export function parseVaultUnlockAt(body: unknown): string | null {
  if (typeof body === "string") {
    const t = body.trim();
    if (!t) return null;
    const ms = Date.parse(t);
    if (!Number.isNaN(ms)) return new Date(ms).toISOString();
    return t;
  }
  if (typeof body === "number" && Number.isFinite(body)) {
    return new Date(body).toISOString();
  }
  if (!body || typeof body !== "object") return null;

  const record = body as Record<string, unknown>;
  if (record.unlockAt !== undefined && record.unlockAt !== null) {
    return parseVaultUnlockAt(record.unlockAt);
  }

  const inner = unwrapPayload(record);
  if (inner !== record) {
    const fromInner = parseVaultUnlockAt(inner);
    if (fromInner) return fromInner;
  }

  return null;
}
