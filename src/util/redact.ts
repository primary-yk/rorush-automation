const SENSITIVE_KEYS = /password|token|secret|key|authorization|cookie|captcha/i;

export function redactForLog(value: unknown): unknown {
  if (value === null || value === undefined) return value;
  if (typeof value === "string") {
    if (value.length > 8 && /^[A-Za-z0-9._-]+$/.test(value)) {
      return "[redacted]";
    }
    return value;
  }
  if (Array.isArray(value)) {
    return value.map(redactForLog);
  }
  if (typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      out[k] = SENSITIVE_KEYS.test(k) ? "[redacted]" : redactForLog(v);
    }
    return out;
  }
  return value;
}

export function safeErrorMessage(err: unknown): string {
  if (err instanceof Error) return err.message;
  return String(err);
}
