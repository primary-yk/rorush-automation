"use client";

import clsx from "clsx";
import { useMemo, useState } from "react";
import { redactEmailsInText, usePrivacyBlur } from "./PrivacyBlur";
import { FormattedDateTime } from "./FormattedDateTime";
import type { ActivityLog } from "@/lib/api";

const CATEGORY_STYLE: Record<string, { dot: string; label: string; border: string; chip: string }> = {
  rain: {
    dot: "bg-violet-400",
    label: "Rain",
    border: "border-l-violet-400/70",
    chip: "bg-violet-500/15 text-violet-200",
  },
  case: {
    dot: "bg-amber-400",
    label: "Cases",
    border: "border-l-amber-400/70",
    chip: "bg-amber-500/15 text-amber-200",
  },
  limbo: {
    dot: "bg-fuchsia-400",
    label: "Limbo",
    border: "border-l-fuchsia-400/70",
    chip: "bg-fuchsia-500/15 text-fuchsia-200",
  },
  discord: {
    dot: "bg-indigo-400",
    label: "Discord",
    border: "border-l-indigo-400/70",
    chip: "bg-indigo-500/15 text-indigo-200",
  },
  system: {
    dot: "bg-slate-400",
    label: "System",
    border: "border-l-slate-400/60",
    chip: "bg-white/5 text-slate-400",
  },
};

/** Routine rain lifecycle lines — hidden in Highlights view. */
const QUIET_MESSAGES = new Set([
  "Rain created",
  "Rain join stage started",
  "Shared rain listener connected",
  "Rain captcha ready",
  "Waiting for rain captcha (one solve per rain batch)",
  "Rain finished",
  "Solving rain captcha",
  "Sending rain join",
]);

function isSummaryLog(log: ActivityLog): boolean {
  return log.message === "Rain join summary";
}

function isHighlightLog(log: ActivityLog): boolean {
  if (isSummaryLog(log)) return true;
  if (log.category === "limbo") return true;
  if (log.category === "case") return true;
  if (QUIET_MESSAGES.has(log.message)) return false;
  if (log.message.includes("failed") || log.message.includes("error")) return true;
  if (log.message.includes("skipped")) return true;
  if (log.message === "Joined rain") return true;
  if (log.message === "Attempting rain join") return true;
  if (log.message === "Rain join batch finished") return true;
  if (log.message === "Rain payout recorded") return true;
  if (log.message.startsWith("Rain join")) return true;
  if (log.category === "system") return log.message.includes("started") || log.message.includes("stopped");
  return false;
}

function categoryMeta(category: string, log: ActivityLog) {
  if (isSummaryLog(log)) {
    return {
      dot: "bg-emerald-400",
      label: "Summary",
      border: "border-l-emerald-400/80",
      chip: "bg-emerald-500/15 text-emerald-200",
    };
  }
  return (
    CATEGORY_STYLE[category] ?? {
      dot: "bg-violet-400",
      label: category,
      border: "border-l-violet-400/60",
      chip: "bg-violet-500/15 text-violet-200",
    }
  );
}

function dayKey(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "Unknown";
  return d.toLocaleDateString(undefined, { weekday: "long", month: "short", day: "numeric", year: "numeric" });
}

function LogRow({
  log,
  accountsById,
  compact,
  blurEmails,
  isLast,
}: {
  log: ActivityLog;
  accountsById?: Map<number, string>;
  compact?: boolean;
  blurEmails: boolean;
  isLast: boolean;
}) {
  const meta = categoryMeta(log.category, log);
  const accountName = log.account_id != null ? accountsById?.get(log.account_id) : undefined;
  const summary = isSummaryLog(log);

  return (
    <li className="relative flex gap-4 pb-6 last:pb-0">
      {!isLast && (
        <span
          className="absolute left-[11px] top-6 h-[calc(100%-12px)] w-px bg-gradient-to-b from-white/10 to-transparent"
          aria-hidden
        />
      )}
      <span
        className={clsx(
          "relative z-10 mt-1.5 h-[22px] w-[22px] shrink-0 rounded-full ring-4 ring-[#07080f]",
          meta.dot,
        )}
      />
      <div
        className={clsx(
          "min-w-0 flex-1 rounded-2xl border border-white/[0.06] border-l-[3px] bg-gradient-to-r from-white/[0.04] to-white/[0.01] px-4 py-3 transition hover:border-white/10 hover:from-white/[0.06]",
          meta.border,
          summary && "from-emerald-500/10 ring-1 ring-emerald-500/20",
        )}
      >
        <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-slate-500">
          <FormattedDateTime iso={log.created_at} />
          <span className={clsx("rounded-md px-1.5 py-0.5 font-medium uppercase tracking-wide", meta.chip)}>
            {meta.label}
          </span>
          {accountName && <span className="font-medium text-violet-300/90">{accountName}</span>}
        </div>
        <p className={clsx("mt-1.5 text-slate-100", compact ? "text-sm" : "text-[15px]")}>
          {redactEmailsInText(log.message, blurEmails)}
        </p>
        {log.detail && (
          <p className="mt-1 whitespace-pre-wrap font-mono text-xs leading-relaxed text-slate-500">
            {redactEmailsInText(log.detail, blurEmails)}
          </p>
        )}
      </div>
    </li>
  );
}

export function ActivityFeed({
  logs,
  accountsById,
  compact,
  maxHeight,
  search,
  showViewToggle = true,
}: {
  logs: ActivityLog[];
  accountsById?: Map<number, string>;
  compact?: boolean;
  maxHeight?: string;
  search?: string;
  /** Full timeline page shows Highlights / All toggle; overview snippet hides it. */
  showViewToggle?: boolean;
}) {
  const [filter, setFilter] = useState<string>("all");
  const [view, setView] = useState<"highlights" | "all">("highlights");
  const { blurEmails } = usePrivacyBlur();

  const categories = useMemo(() => {
    const set = new Set(logs.map((l) => l.category));
    return ["all", ...Array.from(set).sort()];
  }, [logs]);

  const q = search?.trim().toLowerCase() ?? "";

  const filtered = useMemo(() => {
    return logs.filter((l) => {
      if (filter !== "all" && l.category !== filter) return false;
      if (view === "highlights" && !q && !isHighlightLog(l)) return false;
      if (!q) return true;
      return (
        l.message.toLowerCase().includes(q) ||
        (l.detail?.toLowerCase().includes(q) ?? false) ||
        (l.account_id != null && accountsById?.get(l.account_id)?.toLowerCase().includes(q))
      );
    });
  }, [logs, filter, view, q, accountsById]);

  const pinnedSummaries = useMemo(() => {
    if (view !== "highlights" || q) return [];
    return filtered.filter(isSummaryLog).slice(0, 3);
  }, [filtered, view, q]);

  const timelineLogs = useMemo(() => {
    const pinnedIds = new Set(pinnedSummaries.map((l) => l.id));
    return filtered.filter((l) => !pinnedIds.has(l.id));
  }, [filtered, pinnedSummaries]);

  const byDay = useMemo(() => {
    const groups = new Map<string, ActivityLog[]>();
    for (const log of timelineLogs) {
      const key = dayKey(log.created_at);
      const list = groups.get(key) ?? [];
      list.push(log);
      groups.set(key, list);
    }
    return Array.from(groups.entries());
  }, [timelineLogs]);

  const hiddenQuietCount = useMemo(() => {
    if (view === "all" || q) return 0;
    return logs.filter((l) => !isHighlightLog(l)).length;
  }, [logs, view, q]);

  return (
    <div>
      {!compact && (
        <div className="mb-4 flex flex-wrap items-center gap-2">
          {showViewToggle && (
            <div className="mr-1 flex rounded-full border border-white/[0.08] bg-black/30 p-0.5">
              <button
                type="button"
                onClick={() => setView("highlights")}
                className={clsx(
                  "rounded-full px-3 py-1 text-xs font-medium transition",
                  view === "highlights" ? "bg-violet-600/40 text-white" : "text-slate-500 hover:text-slate-300",
                )}
              >
                Highlights
              </button>
              <button
                type="button"
                onClick={() => setView("all")}
                className={clsx(
                  "rounded-full px-3 py-1 text-xs font-medium transition",
                  view === "all" ? "bg-white/12 text-white" : "text-slate-500 hover:text-slate-300",
                )}
              >
                All events
              </button>
            </div>
          )}
          {categories.length > 2 &&
            categories.map((c) => (
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
                {c === "all" ? "All types" : c}
              </button>
            ))}
        </div>
      )}

      {view === "highlights" && !q && hiddenQuietCount > 0 && showViewToggle && (
        <p className="mb-4 text-xs text-slate-500">
          Hiding {hiddenQuietCount} routine rain/captcha lines — switch to{" "}
          <button type="button" className="text-violet-300/90 underline-offset-2 hover:underline" onClick={() => setView("all")}>
            All events
          </button>{" "}
          to see everything.
        </p>
      )}

      {pinnedSummaries.length > 0 && (
        <div className="mb-6">
          <p className="mb-3 text-[11px] font-semibold uppercase tracking-wider text-emerald-400/80">Latest rain results</p>
          <ul className="space-y-0">
            {pinnedSummaries.map((log, i) => (
              <LogRow
                key={`pin-${log.id}`}
                log={log}
                accountsById={accountsById}
                compact={compact}
                blurEmails={blurEmails}
                isLast={i === pinnedSummaries.length - 1 && byDay.length === 0}
              />
            ))}
          </ul>
        </div>
      )}

      <ul
        className={clsx("space-y-0", maxHeight && "overflow-y-auto pr-1 scrollbar-thin")}
        style={maxHeight ? { maxHeight } : undefined}
      >
        {filtered.length === 0 && (
          <li className="rounded-2xl border border-dashed border-white/10 py-12 text-center text-sm text-slate-500">
            {view === "highlights" && !q
              ? "No highlights yet — joins, payouts, and errors will show here."
              : "No events match — try another filter or search."}
          </li>
        )}

        {byDay.map(([label, dayLogs]) => (
          <li key={label} className="list-none">
            {!compact && (
              <div className="sticky top-0 z-20 mb-3 flex items-center gap-3 bg-[#07080f]/90 py-2 backdrop-blur-sm">
                <span className="text-xs font-semibold uppercase tracking-wider text-slate-400">{label}</span>
                <span className="h-px flex-1 bg-gradient-to-r from-white/10 to-transparent" />
              </div>
            )}
            <ul className="space-y-0">
              {dayLogs.map((log, i) => (
                <LogRow
                  key={log.id}
                  log={log}
                  accountsById={accountsById}
                  compact={compact}
                  blurEmails={blurEmails}
                  isLast={i === dayLogs.length - 1}
                />
              ))}
            </ul>
          </li>
        ))}
      </ul>
    </div>
  );
}
