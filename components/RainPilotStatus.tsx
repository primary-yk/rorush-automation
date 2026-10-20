"use client";

import clsx from "clsx";
import type { RainAccountStatus, RainLiveStatus } from "@/lib/api";

const PHASE: Record<
  RainAccountStatus["phase"],
  { label: string; className: string }
> = {
  idle: { label: "Idle", className: "bg-white/10 text-slate-300" },
  solving: { label: "Captcha…", className: "bg-amber-500/20 text-amber-100" },
  ready: { label: "Ready", className: "bg-sky-500/20 text-sky-100" },
  joining: { label: "Joining…", className: "bg-violet-500/25 text-violet-100" },
  joined: { label: "Joined", className: "bg-emerald-500/25 text-emerald-100" },
  failed: { label: "Failed", className: "bg-rose-500/20 text-rose-100" },
  skipped: { label: "Skipped", className: "bg-slate-500/20 text-slate-400" },
};

export function RainPilotStatus({ status }: { status: RainLiveStatus }) {
  if (!status.active || status.accountStatuses.length === 0) return null;

  return (
    <div className="mb-6 rounded-2xl border border-white/[0.06] bg-black/30 p-4">
      <p className="text-[11px] font-semibold uppercase tracking-widest text-violet-300/80">
        Pilots this rain
      </p>
      <ul className="mt-3 flex flex-col gap-2">
        {status.accountStatuses.map((row) => {
          const meta = PHASE[row.phase];
          return (
            <li
              key={`${row.accountId}-${row.nickname}`}
              className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-white/[0.04] bg-black/25 px-3 py-2.5"
            >
              <span className="font-medium text-slate-100">{row.nickname}</span>
              <div className="flex flex-wrap items-center gap-2">
                <span className={clsx("rounded-full px-2.5 py-0.5 text-xs font-semibold", meta.className)}>
                  {meta.label}
                </span>
                {row.detail && (
                  <span className="max-w-[12rem] truncate text-xs text-slate-500" title={row.detail}>
                    {row.detail}
                  </span>
                )}
              </div>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
