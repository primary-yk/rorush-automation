import { solveCaptcha } from "../captcha/solve.js";

/** hCaptcha tokens are short-lived; refresh if older than this. */
const TOKEN_TTL_MS = 100_000;

const cache = new Map<string, { token: string; at: number }>();
const inflight = new Map<string, Promise<string | null>>();

function cacheKey(rainId: string): string {
  return rainId;
}

function readCached(rainId: string): string | null {
  const row = cache.get(cacheKey(rainId));
  if (!row) return null;
  if (Date.now() - row.at > TOKEN_TTL_MS) {
    cache.delete(cacheKey(rainId));
    return null;
  }
  return row.token;
}

/** Start solving during tip stage so the token is ready when the join window opens (~90s). */
export function prewarmRainCaptcha(rainId: string): void {
  if (!rainId || readCached(rainId)) return;
  if (inflight.has(cacheKey(rainId))) return;
  const p = solveCaptcha("hcaptcha")
    .then((token) => {
      if (token) cache.set(cacheKey(rainId), { token, at: Date.now() });
      return token;
    })
    .finally(() => {
      inflight.delete(cacheKey(rainId));
    });
  inflight.set(cacheKey(rainId), p);
}

/** Use cached token from prewarm when possible; otherwise solve now. */
export async function takeRainCaptchaToken(rainId: string): Promise<string | null> {
  const cached = readCached(rainId);
  if (cached) return cached;

  let p = inflight.get(cacheKey(rainId));
  if (!p) {
    p = solveCaptcha("hcaptcha").then((token) => {
      if (token) cache.set(cacheKey(rainId), { token, at: Date.now() });
      return token;
    });
    inflight.set(cacheKey(rainId), p);
    void p.finally(() => inflight.delete(cacheKey(rainId)));
  }
  return p;
}

export function clearRainCaptcha(rainId: string): void {
  cache.delete(cacheKey(rainId));
  inflight.delete(cacheKey(rainId));
}
