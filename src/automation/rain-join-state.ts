import { hasSuccessfulRainJoin } from "../db/repositories.js";

const joinedThisSession = new Set<string>();
const joinInflight = new Map<string, Promise<{ success: boolean; reason: string }>>();

function key(accountId: number, rainId: string): string {
  return `${accountId}:${rainId}`;
}

export function isRainJoined(accountId: number, rainId: string): boolean {
  return joinedThisSession.has(key(accountId, rainId)) || hasSuccessfulRainJoin(accountId, rainId);
}

export function markRainJoined(accountId: number, rainId: string): void {
  joinedThisSession.add(key(accountId, rainId));
}

export function clearRainJoinStateForRain(rainId: string): void {
  const suffix = `:${rainId}`;
  for (const k of joinedThisSession) {
    if (k.endsWith(suffix)) joinedThisSession.delete(k);
  }
  for (const k of joinInflight.keys()) {
    if (k.endsWith(suffix)) joinInflight.delete(k);
  }
}

export function trackJoinInflight(
  accountId: number,
  rainId: string,
  work: () => Promise<{ success: boolean; reason: string }>,
): Promise<{ success: boolean; reason: string }> {
  const k = key(accountId, rainId);
  const existing = joinInflight.get(k);
  if (existing) return existing;
  const p = work().finally(() => joinInflight.delete(k));
  joinInflight.set(k, p);
  return p;
}
