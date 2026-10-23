/** Best-effort JWT `exp` (display / refresh timing only; not cryptographically verified). */
export function parseJwtExpiryUtc(jwt: string): Date | null {
  const parts = jwt.trim().split(".");
  if (parts.length < 2) return null;
  try {
    const payloadJson = Buffer.from(parts[1]!, "base64url").toString("utf8");
    const payload = JSON.parse(payloadJson) as { exp?: unknown };
    if (typeof payload.exp !== "number" || !Number.isFinite(payload.exp)) return null;
    return new Date(payload.exp * 1000);
  } catch {
    return null;
  }
}
