"use client";

import clsx from "clsx";
import type { RainLiveStatus } from "@/lib/api";

function fmtPool(coins: number | null): string {
  if (coins == null) return "—";
  return coins >= 1000 ? `${(coins / 1000).toFixed(1)}k` : coins.toFixed(0);
}

function fmtCountdown(totalSec: number): string {
  const s = Math.max(0, totalSec);
  const m = Math.floor(s / 60);
  const r = s % 60;
  return `${m}:${r.toString().padStart(2, "0")}`;
}

export function LiveRainStrip({ status }: { status: RainLiveStatus }) {
  const show =
    status.active ||
    status.joinWindowOpen ||
    status.captchaWaitingSec != null ||
    (status.joinedNicknames.length > 0 && status.active);

  if (!show && !status.lastSummary) return null;

  const readyCount = status.accountStatuses.filter(
    (s) => s.phase === "ready" || s.phase === "joined",
  ).length;
  const totalPilots = status.accountStatuses.filter((s) => s.phase !== "skipped").length;

  const captchaLabel = status.captchaReady
    ? status.captchaSolveSec != null
      ? `Captcha ready · ${status.captchaSolveSec.toFixed(0)}s`
      : `Captchas ${readyCount}/${totalPilots || "?"} ready`
    : status.captchaWaitingSec != null
      ? `Waiting captcha · ${status.captchaWaitingSec}s`
      : "Captcha idle";

  let windowLabel = "No active rain";
  let countdownLabel: string | null = null;
  if (status.active) {
    if (status.joinWindowOpen) {
      windowLabel = "Join window open";
      countdownLabel = `${fmtCountdown(status.joinWindowRemainingSec)} left`;
    } else if (status.joinOpensInSec > 0) {
      windowLabel = "Join opens in";
      countdownLabel = fmtCountdown(status.joinOpensInSec);
    } else {
      windowLabel = "Tip / pre-join stage";
    }
  }

  return (
    <div className="mb-8 space-y-3">
      <div
        className={clsx(
          "relative overflow-hidden rounded-2xl border px-4 py-4 sm:px-5",
          status.joinWindowOpen
            ? "border-violet-400/45 bg-gradient-to-r from-violet-600/20 via-fuchsia-600/10 to-transparent"
            : status.active
              ? "border-violet-500/35 bg-gradient-to-r from-violet-500/15 to-black/40"
              : "border-violet-500/10 bg-black/40",
        )}
      >
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <p className="text-[11px] font-semibold uppercase tracking-widest text-violet-300/90">
              Live rain
            </p>
            <p className="mt-1 font-display text-xl font-bold text-white sm:text-2xl">
              {status.active ? `${fmtPool(status.poolCoins)} coin pool` : "Listening for rain"}
            </p>
            {countdownLabel && (
              <p className="mt-2 font-mono text-2xl font-bold tabular-nums text-violet-100 sm:text-3xl">
                {countdownLabel}
              </p>
            )}
            <p className="mt-1 text-xs text-slate-500">{windowLabel}</p>
            {status.rainId && (
              <p className="mt-1 font-mono text-xs text-slate-600">{status.rainId.slice(0, 8)}…</p>
            )}
          </div>
          <div className="flex flex-wrap gap-2 text-xs">
            <span
              className={clsx(
                "rounded-full px-3 py-1 font-medium",
                status.listenerConnected ? "bg-emerald-500/20 text-emerald-200" : "bg-rose-500/20 text-rose-200",
              )}
            >
              SignalR {status.listenerConnected ? "on" : "off"}
            </span>
            <span className="rounded-full bg-white/10 px-3 py-1 text-slate-200">{captchaLabel}</span>
            {status.joinWindowTotalSec > 0 && status.joinWindowOpen && (
              <span className="rounded-full bg-white/10 px-3 py-1 text-slate-200">
                Window · {status.joinWindowTotalSec}s total
              </span>
            )}
            {status.joinAttempts > 0 && (
              <span className="rounded-full bg-white/10 px-3 py-1 text-slate-200">
                Join tries · {status.joinAttempts}
              </span>
            )}
          </div>
        </div>
        {status.joinedNicknames.length > 0 && (
          <p className="mt-3 text-sm text-emerald-200/90">
            Joined: <span className="font-medium text-white">{status.joinedNicknames.join(", ")}</span>
          </p>
        )}
      </div>
      {status.lastSummary && !status.active && (
        <p className="rounded-xl border border-white/[0.06] bg-black/25 px-4 py-2.5 text-sm text-slate-400">
          Last rain · <span className="text-slate-200">{status.lastSummary}</span>
        </p>
      )}
    </div>
  );
}
