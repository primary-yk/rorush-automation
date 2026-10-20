"use client";

import clsx from "clsx";
import { useMemo, useState } from "react";
import { FormattedDateTime } from "./FormattedDateTime";
import type { ActivityLog } from "@/lib/api";

const CATEGORY_STYLE: Record<string, { dot: string; label: string; border: string }> = {
  rain: { dot: "bg-sky-400", label: "Rain", border: "border-l-sky-400/70" },
  case: { dot: "bg-amber-400", label: "Cases", border: "border-l-amber-400/70" },
  limbo: { dot: "bg-fuchsia-400", label: "Limbo", border: "border-l-fuchsia-400/70" },
  discord: { dot: "bg-indigo-400", label: "Discord", border: "border-l-indigo-400/70" },
  system: { dot: "bg-slate-400", label: "System", border: "border-l-slate-400/60" },
};

function categoryMeta(category: string) {
  return (
    CATEGORY_STYLE[category] ?? {
      dot: "bg-violet-400",
      label: category,
      border: "border-l-violet-400/60",
    }
  );
}

export function ActivityFeed({
  logs,
  accountsById,
  compact,
  maxHeight,
  search,
}: {
  logs: ActivityLog[];
  accountsById?: Map<number, string>;
  compact?: boolean;
  maxHeight?: string;
  search?: string;
}) {
  const [filter, setFilter] = useState<string>("all");

  const categories = useMemo(() => {
    const set = new Set(logs.map((l) => l.category));
    return ["all", ...Array.from(set).sort()];
  }, [logs]);

  const q = search?.trim().toLowerCase() ?? "";
  const filtered = logs.filter((l) => {
    if (filter !== "all" && l.category !== filter) return false;
    if (!q) return true;
    return (
      l.message.toLowerCase().includes(q) ||
      (l.detail?.toLowerCase().includes(q) ?? false) ||
      (l.account_id != null && accountsById?.get(l.account_id)?.toLowerCase().includes(q))
    );
  });

  return (
    <div>
      {!compact && categories.length > 2 && (
        <div className="mb-4 flex flex-wrap gap-2">
          {categories.map((c) => (
            <button
              key={c}
              type="button"
              onClick={() => setFilter(c)}
              className={clsx(
                "rounded-full px-3 py-1 text-xs font-medium capitalize transition",
                filter === c
                  ? "bg-white/12 text-white"
                  : "bg-white/[0.03] text-slate-500 hover:text-slate-300",
              )}
            >
              {c === "all" ? "All" : c}
            </button>
          ))}
        </div>
      )}

      <ul
        className={clsx("space-y-0", maxHeight && "overflow-y-auto pr-1 scrollbar-thin")}
        style={maxHeight ? { maxHeight } : undefined}
      >
        {filtered.length === 0 && (
          <li className="rounded-2xl border border-dashed border-white/10 py-12 text-center text-sm text-slate-500">
            No activity yet — when rain or cases run, entries show up here.
          </li>
        )}
        {filtered.map((log, i) => {
          const isSummary = log.message === "Rain join summary";
          const meta = isSummary
            ? { dot: "bg-emerald-400", label: "Summary", border: "border-l-emerald-400/80" }
            : categoryMeta(log.category);
          const accountName =
            log.account_id != null ? accountsById?.get(log.account_id) : undefined;
          return (
            <li key={log.id} className="relative flex gap-4 pb-6 last:pb-0">
              {i < filtered.length - 1 && (
                <span
                  className="absolute left-[11px] top-6 h-[calc(100%-12px)] w-px bg-gradient-to-b from-white/10 to-transparent"
                  aria-hidden
                />
              )}
              <span
                className={clsx("relative z-10 mt-1.5 h-[22px] w-[22px] shrink-0 rounded-full ring-4 ring-[#07080f]", meta.dot)}
              />
              <div
                className={clsx(
                  "min-w-0 flex-1 rounded-2xl border border-white/[0.06] border-l-[3px] bg-gradient-to-r from-white/[0.04] to-white/[0.01] px-4 py-3 transition hover:border-white/10 hover:from-white/[0.06]",
                  meta.border,
                  isSummary && "from-emerald-500/10 ring-1 ring-emerald-500/20",
                )}
              >
                <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-slate-500">
                  <FormattedDateTime iso={log.created_at} />
                  <span className="rounded-md bg-white/5 px-1.5 py-0.5 font-medium uppercase tracking-wide text-slate-400">
                    {meta.label}
                  </span>
                  {accountName && <span className="text-violet-300/80">{accountName}</span>}
                </div>
                <p className={clsx("mt-1.5 text-slate-100", compact ? "text-sm" : "text-[15px]")}>{log.message}</p>
                {log.detail && (
                  <p className="mt-1 font-mono text-xs leading-relaxed text-slate-500">{log.detail}</p>
                )}
              </div>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
