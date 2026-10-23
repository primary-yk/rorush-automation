import { fetch } from "undici";
import { parseCaptchaApiBody } from "./parse-body.js";

const BASE = "https://api.nonecap.com/v1";

export type NonecapSolve = {
  id?: string;
  status?: string;
  token?: string | null;
  error?: { code?: string; message?: string; retryable?: boolean } | null;
};

type NonecapMe = {
  credits_balance?: number;
  error?: { code?: string; message?: string };
};

function authHeaders(apiKey: string): Record<string, string> {
  return {
    Authorization: `Bearer ${apiKey.trim()}`,
    Accept: "application/json",
    "Content-Type": "application/json",
  };
}

function nonecapHttpError(body: unknown, status: number): Error {
  if (body && typeof body === "object" && "error" in body) {
    const err = (body as { error?: { message?: string; code?: string } }).error;
    const msg = err?.message?.trim() || err?.code || `NoneCap HTTP ${status}`;
    return new Error(msg);
  }
  return new Error(`NoneCap HTTP ${status}`);
}

async function nonecapRequest<T>(
  method: string,
  path: string,
  apiKey: string,
  init?: { body?: unknown; query?: Record<string, string> },
): Promise<{ status: number; data: T }> {
  const timeoutMs = Math.max(5_000, Number(process.env.CAPTCHA_HTTP_TIMEOUT_MS ?? 45_000) || 45_000);
  const q = init?.query ? `?${new URLSearchParams(init.query).toString()}` : "";
  const url = `${BASE}${path}${q}`;
  const res = await fetch(url, {
    method,
    headers: authHeaders(apiKey),
    body: init?.body != null ? JSON.stringify(init.body) : undefined,
    signal: AbortSignal.timeout(timeoutMs),
  });
  const text = await res.text();
  const data = parseCaptchaApiBody(text, url) as T;
  if (!res.ok) {
    throw nonecapHttpError(data, res.status);
  }
  return { status: res.status, data };
}

function nonecapKeyLooksValid(apiKey: string): boolean {
  return /^nc_live_[A-Za-z0-9_-]{20,}$/.test(apiKey.trim());
}

/** Balance check needs `account` scope; rain solves only need `solve` scope. */
export function isNonecapAccountScopeError(message: string): boolean {
  return /missing the ['"]account['"] scope|account scope|lacks the scope.*account/i.test(
    message,
  );
}

export async function verifyNonecapKey(apiKey: string): Promise<{
  ok: boolean;
  credits?: number;
  errorDescription?: string;
  /** Key is valid for solves but /v1/me was blocked (no account scope on the key). */
  balanceUnavailable?: boolean;
}> {
  const trimmed = apiKey.trim();
  if (!nonecapKeyLooksValid(trimmed)) {
    return {
      ok: false,
      errorDescription: "NoneCap keys start with nc_live_ — copy from dashboard.nonecap.com → Keys",
    };
  }
  try {
    const { data } = await nonecapRequest<NonecapMe>("GET", "/me", trimmed);
    if (data.error?.message) {
      if (isNonecapAccountScopeError(data.error.message)) {
        return { ok: true, balanceUnavailable: true };
      }
      return { ok: false, errorDescription: data.error.message };
    }
    if (typeof data.credits_balance !== "number") {
      return { ok: false, errorDescription: "Unexpected /v1/me response" };
    }
    return { ok: true, credits: data.credits_balance };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    if (isNonecapAccountScopeError(msg)) {
      return { ok: true, balanceUnavailable: true };
    }
    return { ok: false, errorDescription: msg };
  }
}

function terminalFailure(solve: NonecapSolve): string | null {
  const st = solve.status?.toLowerCase();
  if (st === "failed" || st === "cancelled" || st === "expired") {
    return (
      solve.error?.message?.trim() ||
      solve.error?.code ||
      `NoneCap solve ${st ?? "failed"}`
    );
  }
  return null;
}

export async function cancelNonecapSolve(apiKey: string, solveId: string): Promise<void> {
  try {
    await nonecapRequest("DELETE", `/solves/${encodeURIComponent(solveId)}`, apiKey);
  } catch {
    /* best-effort */
  }
}

export async function solveNonecapHcaptcha(input: {
  apiKey: string;
  sitekey: string;
  pageUrl: string;
  cancelAfterMs: number;
}): Promise<string> {
  const pollMs = Math.max(400, Number(process.env.CAPTCHA_POLL_MS ?? 500) || 500);
  const maxPolls = Math.max(20, Number(process.env.CAPTCHA_MAX_POLLS ?? 180) || 180);
  const verbose = /^(1|true|yes|on)$/i.test(process.env.CAPTCHA_VERBOSE?.trim() ?? "");
  const started = Date.now();
  const waitSec = Math.min(90, Math.max(1, Math.floor(input.cancelAfterMs / 1000)));

  const createBody = {
    type: "hcaptcha",
    sitekey: input.sitekey,
    url: input.pageUrl,
  };

  const { status: createStatus, data: created } = await nonecapRequest<NonecapSolve>(
    "POST",
    "/solves",
    input.apiKey,
    { body: createBody, query: { wait: String(waitSec) } },
  );

  let solve = created;
  const solveId = solve.id;
  if (!solveId) {
    throw new Error("NoneCap create solve did not return an id");
  }

  if (verbose) {
    console.log(
      `[captcha] NoneCap task ${solveId.slice(0, 12)}… · status=${solve.status ?? "?"} · wait=${waitSec}s`,
    );
  }

  const tryFinish = (): string | null => {
    const fail = terminalFailure(solve);
    if (fail) throw new Error(fail);
    if (solve.status === "solved" && solve.token?.trim()) {
      return solve.token.trim();
    }
    return null;
  };

  let token = tryFinish();
  if (token) return token;

  if (createStatus === 202 || solve.status === "pending" || solve.status === "solving") {
    for (let i = 0; i < maxPolls; i++) {
      if (Date.now() - started >= input.cancelAfterMs) {
        await cancelNonecapSolve(input.apiKey, solveId);
        throw new Error(
          `Captcha processing stall ~${Math.round((Date.now() - started) / 1000)}s — NoneCap task cancelled`,
        );
      }
      if (i > 0) {
        await new Promise((r) => setTimeout(r, pollMs));
      }
      const pollWait = Math.min(10, Math.max(1, Math.floor((input.cancelAfterMs - (Date.now() - started)) / 1000)));
      const { data: polled } = await nonecapRequest<NonecapSolve>(
        "GET",
        `/solves/${encodeURIComponent(solveId)}`,
        input.apiKey,
        { query: { wait: String(pollWait) } },
      );
      solve = polled;
      if (verbose && (i === 0 || i % 5 === 0)) {
        console.log(
          `[captcha] NoneCap poll ${i + 1}/${maxPolls} · ${Math.round((Date.now() - started) / 1000)}s · status=${solve.status ?? "?"}`,
        );
      }
      token = tryFinish();
      if (token) return token;
    }
    await cancelNonecapSolve(input.apiKey, solveId);
    throw new Error(
      `Captcha solve timed out after ~${Math.round((Date.now() - started) / 1000)}s (NoneCap, last status ${solve.status ?? "unknown"})`,
    );
  }

  throw new Error("NoneCap returned no token — check sitekey and RORUSH_SITE_URL");
}
