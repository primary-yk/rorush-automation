/** RoRush amounts from /user/balance are usually integer cents; level lives on /user/level as currentLevel. */

function coerceNumber(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim() !== "") {
    const n = Number(value);
    if (Number.isFinite(n)) return n;
  }
  return null;
}

function unwrapPayload(body: Record<string, unknown>): unknown {
  if ("data" in body && body.data !== undefined) return body.data;
  if ("result" in body && body.result !== undefined) return body.result;
  return body;
}

/** Parse RoRush GET /user/balance?currency=crypto (body is often a bare number in cents). */
export function parseBalanceCents(body: unknown): number | null {
  const direct = coerceNumber(body);
  if (direct != null) return direct;

  if (!body || typeof body !== "object") return null;
  const record = body as Record<string, unknown>;
  const inner = unwrapPayload(record);
  if (inner !== record) {
    const fromInner = parseBalanceCents(inner);
    if (fromInner != null) return fromInner;
  }

  for (const key of ["balance", "cryptoBalance", "funBalance", "robuxBalance", "amount"] as const) {
    const v = record[key];
    if (typeof v === "number" && Number.isFinite(v)) return v;
  }
  return null;
}

/** Parse RoRush GET /user/level (levelInfo with currentLevel). */
export function parseLevel(body: unknown): number | null {
  const direct = coerceNumber(body);
  if (direct != null) return Math.trunc(direct);

  if (!body || typeof body !== "object") return null;
  const record = body as Record<string, unknown>;
  const inner = unwrapPayload(record);
  if (inner !== record && inner && typeof inner === "object") {
    const fromInner = parseLevel(inner);
    if (fromInner != null) return fromInner;
  }

  for (const key of ["level", "currentLevel", "userLevel"] as const) {
    const v = record[key];
    if (typeof v === "number" && Number.isFinite(v)) return Math.trunc(v);
    if (typeof v === "string" && v.trim() !== "") {
      const n = Number(v);
      if (Number.isFinite(n)) return Math.trunc(n);
    }
  }
  const nested = record.userInfo as Record<string, unknown> | undefined;
  if (nested && typeof nested.level === "number") return Math.trunc(nested.level);
  return null;
}
