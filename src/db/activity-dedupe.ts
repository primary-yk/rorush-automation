/** Suppress duplicate dashboard / Discord activity lines (SignalR retries, double settlement). */

const recent = new Map<string, number>();

function dedupeKey(input: {
  accountId?: number | null;
  category: string;
  message: string;
  detail?: string | null;
}): string {
  const rainId = input.detail?.match(/[0-9a-f-]{36}/i)?.[0] ?? "";
  return `${input.accountId ?? "g"}|${input.category}|${input.message}|${rainId}`;
}

function dedupeWindowMs(input: { category: string; accountId?: number | null; message: string }): number {
  if (input.category === "rain" && input.accountId == null) return 8_000;
  if (/^Limbo skipped after rain$/i.test(input.message)) return 60_000;
  if (/^Rain join skipped/i.test(input.message)) return 120_000;
  return 3_000;
}

export function shouldSkipDuplicateActivityLog(input: {
  accountId?: number | null;
  category: string;
  message: string;
  detail?: string | null;
}): boolean {
  const key = dedupeKey(input);
  const now = Date.now();
  const windowMs = dedupeWindowMs(input);
  const prev = recent.get(key);
  if (prev != null && now - prev < windowMs) return true;
  recent.set(key, now);
  if (recent.size > 600) {
    for (const [k, t] of recent) {
      if (now - t > 120_000) recent.delete(k);
    }
  }
  return false;
}

export function clearActivityDedupeForRain(rainId: string): void {
  for (const key of recent.keys()) {
    if (key.includes(rainId)) recent.delete(key);
  }
}
