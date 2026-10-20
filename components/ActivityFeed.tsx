"use client";

import clsx from "clsx";
import { useMemo, useState, type ReactNode } from "react";
import { redactEmailsInText, usePrivacyBlur } from "./PrivacyBlur";
import { FormattedClock, FormattedDayLabel } from "./FormattedDateTime";
import type { ActivityLog } from "@/lib/api";

type Tone = "success" | "danger" | "warn" | "neutral" | "summary";

const CATEGORY_STYLE: Record<
  string,
  { label: string; icon: string; chip: string; row: string; glow: string }
> = {
  rain: {
    label: "Rain",
    icon: "◆",
    chip: "bg-violet-500/20 text-violet-100 ring-violet-400/30",
    row: "border-violet-500/15 hover:border-violet-400/25",
    glow: "from-violet-600/10",
  },
  case: {
    label: "Cases",
    icon: "▣",
    chip: "bg-amber-500/15 text-amber-100 ring-amber-400/25",
    row: "border-amber-500/15 hover:border-amber-400/25",
    glow: "from-amber-600/8",
  },
  limbo: {
    label: "Limbo",
    icon: "◎",
    chip: "bg-fuchsia-500/15 text-fuchsia-100 ring-fuchsia-400/25",
    row: "border-fuchsia-500/15 hover:border-fuchsia-400/25",
    glow: "from-fuchsia-600/10",
  },
  discord: {
    label: "Discord",
    icon: "◈",
    chip: "bg-indigo-500/15 text-indigo-100 ring-indigo-400/25",
    row: "border-indigo-500/15 hover:border-indigo-400/25",
    glow: "from-indigo-600/8",
  },
  system: {
    label: "System",
    icon: "◇",
    chip: "bg-white/5 text-slate-300 ring-white/10",
    row: "border-white/8 hover:border-white/15",
    glow: "from-slate-600/5",
  },
};

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

function logTone(log: ActivityLog): Tone {
  if (isSummaryLog(log)) return "summary";
  const m = log.message.toLowerCase();
  if (m.includes("fail") || m.includes("error")) return "danger";
  if (m.includes("joined") || m.includes("payout") || m.includes("opened")) return "success";
  if (m.includes("skipped") || m.includes("waiting")) return "warn";
  return "neutral";
}

function categoryMeta(category: string, log: ActivityLog) {
  if (isSummaryLog(log)) {
    return {
      label: "Summary",
      icon: "★",
      chip: "bg-emerald-500/20 text-emerald-100 ring-emerald-400/35",
      row: "border-emerald-500/25 hover:border-emerald-400/35",
      glow: "from-emerald-600/15",
    };
  }
  return (
    CATEGORY_STYLE[category] ?? {
      label: category,
      icon: "•",
      chip: "bg-violet-500/15 text-violet-100 ring-violet-400/25",
      row: "border-violet-500/15 hover:border-violet-400/25",
      glow: "from-violet-600/10",
    }
  );
}

const TONE_STRIPE: Record<Tone, string> = {
  success: "bg-emerald-400",
  danger: "bg-rose-400",
  warn: "bg-amber-400",
  neutral: "bg-violet-500/60",
  summary: "bg-emerald-300",
};

function dayBucket(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "unknown";
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

function parseSummaryDetail(detail: string | null | undefined): { parts: string[]; joined?: string } {
  if (!detail) return { parts: [] };
  const parts = detail.split(" · ").map((s) => s.trim());
  const joined = parts.find((p) => p.startsWith("joined "));
  return { parts, joined };
}

function StatTile({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div className="vibe-stat-tile">
      <p className="text-[10px] font-semibold uppercase tracking-[0.2em] text-violet-300/70">{label}</p>
      <p className="mt-1 font-display text-2xl font-bold tabular-nums text-white">{value}</p>
      {sub && <p className="mt-0.5 text-[11px] text-slate-500">{sub}</p>}
    </div>
  );
}

function FilterChip({
  active,
  onClick,
  children,
  count,
}: {
  active: boolean;
  onClick: () => void;
  children: ReactNode;
  count?: number;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={clsx(
        "flex w-full items-center justify-between gap-2 rounded-xl px-3 py-2.5 text-left text-sm transition",
        active
          ? "bg-violet-600/25 text-white ring-1 ring-violet-400/35"
          : "text-slate-400 hover:bg-white/[0.04] hover:text-slate-200",
      )}
    >
      <span className="capitalize">{children}</span>
      {count != null && (
        <span className={clsx("rounded-md px-1.5 py-0.5 text-[11px] tabular-nums", active ? "bg-black/30" : "bg-white/5")}>
          {count}
        </span>
      )}
    </button>
  );
}

function SummaryHeroCard({
  log,
  blurEmails,
}: {
  log: ActivityLog;
  blurEmails: boolean;
}) {
  const { parts } = parseSummaryDetail(log.detail);
  return (
    <article className="vibe-summary-card group relative overflow-hidden rounded-2xl border border-emerald-500/25 bg-gradient-to-br from-emerald-600/15 via-black/50 to-violet-900/20 p-5 shadow-glow-violet">
      <div className="pointer-events-none absolute -right-8 -top-8 h-32 w-32 rounded-full bg-emerald-400/10 blur-3xl transition group-hover:bg-emerald-400/15" />
      <div className="relative flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="text-[11px] font-semibold uppercase tracking-[0.22em] text-emerald-300/90">Rain batch result</p>
          <p className="mt-2 font-display text-lg font-semibold text-white">Join summary</p>
          <p className="mt-1 text-xs text-slate-500">
            <FormattedClock iso={log.created_at} showSeconds />
          </p>
        </div>
        <span className="rounded-full bg-emerald-500/20 px-3 py-1 text-xs font-medium text-emerald-100 ring-1 ring-emerald-400/30">
          ★ Summary
        </span>
      </div>
      {parts.length > 0 && (
        <dl className="relative mt-4 grid gap-2 sm:grid-cols-2">
          {parts.map((part) => {
            const [head, ...rest] = part.split(" ");
            const val = rest.join(" ");
            return (
              <div key={part} className="rounded-xl border border-white/[0.06] bg-black/30 px-3 py-2">
                <dt className="text-[10px] font-semibold uppercase tracking-wider text-slate-500">{head}</dt>
                <dd className="mt-0.5 text-sm text-slate-200">{redactEmailsInText(val || part, blurEmails)}</dd>
              </div>
            );
          })}
        </dl>
      )}
      {log.detail && parts.length === 0 && (
        <p className="relative mt-3 font-mono text-xs text-slate-400">{redactEmailsInText(log.detail, blurEmails)}</p>
      )}
    </article>
  );
}

function EventRow({
  log,
  accountsById,
  blurEmails,
  compact,
}: {
  log: ActivityLog;
  accountsById?: Map<number, string>;
  blurEmails: boolean;
  compact?: boolean;
}) {
  const meta = categoryMeta(log.category, log);
  const tone = logTone(log);
  const accountName = log.account_id != null ? accountsById?.get(log.account_id) : undefined;
  const detail = log.detail?.trim();
  const longDetail = detail != null && detail.length > 72;

  return (
    <article
      className={clsx(
        "group relative flex flex-col gap-2 overflow-hidden rounded-xl border bg-gradient-to-r to-black/40 px-3 py-3 transition sm:flex-row sm:items-start sm:gap-4 sm:px-4",
        meta.row,
        compact && "py-2.5",
      )}
    >
      <div className={clsx("absolute left-0 top-0 h-full w-1", TONE_STRIPE[tone])} aria-hidden />
      <div className="flex shrink-0 items-center gap-3 sm:w-[5.5rem] sm:flex-col sm:items-start sm:pt-0.5">
        <span className="font-mono text-xs text-violet-200/80">
          <FormattedClock iso={log.created_at} showSeconds={!compact} />
        </span>
      </div>
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-2">
          <span className={clsx("inline-flex items-center gap-1 rounded-md px-2 py-0.5 text-[11px] font-semibold uppercase tracking-wide ring-1", meta.chip)}>
            <span className="opacity-80">{meta.icon}</span>
            {meta.label}
          </span>
          {accountName && (
            <span className="rounded-full bg-violet-500/15 px-2.5 py-0.5 text-xs font-medium text-violet-100 ring-1 ring-violet-400/20">
              {accountName}
            </span>
          )}
        </div>
        <p className={clsx("mt-1.5 font-medium leading-snug text-slate-100", compact ? "text-sm" : "text-[15px]")}>
          {redactEmailsInText(log.message, blurEmails)}
        </p>
        {detail && !longDetail && (
          <p className="mt-1 font-mono text-[11px] leading-relaxed text-slate-500">{redactEmailsInText(detail, blurEmails)}</p>
        )}
        {detail && longDetail && (
          <details className="mt-2 rounded-lg border border-white/[0.06] bg-black/25 px-3 py-2 open:pb-3">
            <summary className="cursor-pointer text-xs text-violet-300/90 marker:text-violet-500">Details</summary>
            <p className="mt-2 whitespace-pre-wrap font-mono text-[11px] leading-relaxed text-slate-500">
              {redactEmailsInText(detail, blurEmails)}
            </p>
          </details>
        )}
      </div>
    </article>
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
  showViewToggle?: boolean;
}) {
  const [filter, setFilter] = useState<string>("all");
  const [view, setView] = useState<"highlights" | "all">("highlights");
  const [collapsedDays, setCollapsedDays] = useState<Set<string>>(() => new Set());
  const { blurEmails } = usePrivacyBlur();

  const q = search?.trim().toLowerCase() ?? "";

  const categoryCounts = useMemo(() => {
    const m = new Map<string, number>();
    for (const l of logs) m.set(l.category, (m.get(l.category) ?? 0) + 1);
    return m;
  }, [logs]);

  const stats = useMemo(() => {
    const errors = logs.filter((l) => logTone(l) === "danger").length;
    const joins = logs.filter((l) => l.message === "Joined rain").length;
    const summaries = logs.filter(isSummaryLog).length;
    const highlights = logs.filter(isHighlightLog).length;
    return { errors, joins, summaries, highlights, total: logs.length };
  }, [logs]);

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

  const summaries = useMemo(() => {
    if (view !== "highlights" || q) return [];
    return filtered.filter(isSummaryLog).slice(0, 2);
  }, [filtered, view, q]);

  const summaryIds = useMemo(() => new Set(summaries.map((s) => s.id)), [summaries]);

  const timelineLogs = useMemo(() => filtered.filter((l) => !summaryIds.has(l.id)), [filtered, summaryIds]);

  const byDay = useMemo(() => {
    const groups = new Map<string, ActivityLog[]>();
    for (const log of timelineLogs) {
      const key = dayBucket(log.created_at);
      const list = groups.get(key) ?? [];
      list.push(log);
      groups.set(key, list);
    }
    return Array.from(groups.entries()).sort((a, b) => b[0].localeCompare(a[0]));
  }, [timelineLogs]);

  const hiddenQuietCount = view === "all" || q ? 0 : logs.filter((l) => !isHighlightLog(l)).length;

  const toggleDay = (key: string) => {
    setCollapsedDays((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  };

  const fullLayout = showViewToggle && !compact;

  const feedBody = (
    <>
      {filtered.length === 0 && (
        <div className="rounded-2xl border border-dashed border-violet-500/20 bg-violet-500/[0.03] py-16 text-center">
          <p className="font-display text-lg text-slate-300">Nothing here yet</p>
          <p className="mx-auto mt-2 max-w-sm text-sm text-slate-500">
            {view === "highlights" && !q
              ? "Joins, payouts, limbo, and errors will stack up as the engine runs."
              : "Try another filter or search term."}
          </p>
        </div>
      )}

      {summaries.length > 0 && (
        <div className="mb-6 grid gap-4 lg:grid-cols-2">
          {summaries.map((log) => (
            <SummaryHeroCard key={log.id} log={log} blurEmails={blurEmails} />
          ))}
        </div>
      )}

      <div className="space-y-4">
        {byDay.map(([dayKey, dayLogs]) => {
          const collapsed = collapsedDays.has(dayKey);
          const firstIso = dayLogs[0]?.created_at ?? "";
          return (
            <section key={dayKey} className="vibe-day-section overflow-hidden rounded-2xl border border-white/[0.06] bg-black/25">
              <button
                type="button"
                onClick={() => toggleDay(dayKey)}
                className="flex w-full items-center gap-3 border-b border-white/[0.05] bg-gradient-to-r from-violet-600/10 to-transparent px-4 py-3 text-left transition hover:from-violet-600/15"
              >
                <span
                  className={clsx(
                    "flex h-7 w-7 items-center justify-center rounded-lg bg-violet-500/15 text-xs text-violet-200 transition",
                    collapsed && "rotate-[-90deg]",
                  )}
                >
                  ▾
                </span>
                <div className="min-w-0 flex-1">
                  <p className="font-display text-sm font-semibold text-white">
                    <FormattedDayLabel iso={firstIso} />
                  </p>
                  <p className="text-[11px] text-slate-500">{dayLogs.length} event{dayLogs.length === 1 ? "" : "s"}</p>
                </div>
                <span className="hidden rounded-full bg-white/5 px-2.5 py-1 font-mono text-[11px] text-slate-400 sm:inline">{dayKey}</span>
              </button>
              {!collapsed && (
                <div className="space-y-2 p-3 sm:p-4">
                  {dayLogs.map((log) => (
                    <EventRow
                      key={log.id}
                      log={log}
                      accountsById={accountsById}
                      blurEmails={blurEmails}
                      compact={compact}
                    />
                  ))}
                </div>
              )}
            </section>
          );
        })}
      </div>
    </>
  );

  if (compact) {
    return (
      <div
        className={clsx(maxHeight && "overflow-y-auto pr-1 scrollbar-thin")}
        style={maxHeight ? { maxHeight } : undefined}
      >
        {feedBody}
      </div>
    );
  }

  return (
    <div className={clsx(fullLayout && "lg:grid lg:grid-cols-[minmax(0,17rem)_1fr] lg:gap-6 xl:grid-cols-[minmax(0,18rem)_1fr]")}>
      {fullLayout && (
        <aside className="mb-6 space-y-4 lg:mb-0 lg:sticky lg:top-28 lg:self-start">
          <div className="vibe-panel rounded-2xl border border-violet-500/15 p-4">
            <p className="text-[11px] font-semibold uppercase tracking-[0.22em] text-violet-300/80">View</p>
            <div className="mt-3 grid grid-cols-2 gap-1 rounded-xl border border-white/[0.06] bg-black/40 p-1">
              <button
                type="button"
                onClick={() => setView("highlights")}
                className={clsx(
                  "rounded-lg py-2 text-xs font-semibold transition",
                  view === "highlights" ? "bg-violet-600/50 text-white shadow-inner" : "text-slate-500 hover:text-slate-300",
                )}
              >
                Highlights
              </button>
              <button
                type="button"
                onClick={() => setView("all")}
                className={clsx(
                  "rounded-lg py-2 text-xs font-semibold transition",
                  view === "all" ? "bg-white/10 text-white" : "text-slate-500 hover:text-slate-300",
                )}
              >
                All events
              </button>
            </div>
            {view === "highlights" && !q && hiddenQuietCount > 0 && (
              <p className="mt-3 text-[11px] leading-relaxed text-slate-500">
                <span className="font-medium text-violet-300/90">{hiddenQuietCount}</span> routine lines hidden (captcha, rain created…)
              </p>
            )}
          </div>

          <div className="vibe-panel rounded-2xl border border-violet-500/15 p-4">
            <p className="text-[11px] font-semibold uppercase tracking-[0.22em] text-violet-300/80">Categories</p>
            <div className="mt-3 space-y-1">
              <FilterChip active={filter === "all"} onClick={() => setFilter("all")} count={logs.length}>
                All types
              </FilterChip>
              {[...categoryCounts.entries()]
                .sort((a, b) => a[0].localeCompare(b[0]))
                .map(([cat, count]) => (
                  <FilterChip key={cat} active={filter === cat} onClick={() => setFilter(cat)} count={count}>
                    {CATEGORY_STYLE[cat]?.label ?? cat}
                  </FilterChip>
                ))}
            </div>
          </div>
        </aside>
      )}

      <div className="min-w-0">
        {fullLayout && (
          <div className="mb-6 grid grid-cols-2 gap-3 sm:grid-cols-4">
            <StatTile label="Showing" value={String(filtered.length)} sub={`of ${stats.total} total`} />
            <StatTile label="Highlights" value={String(stats.highlights)} sub="Important events" />
            <StatTile label="Joins" value={String(stats.joins)} sub="Successful rain joins" />
            <StatTile label="Errors" value={String(stats.errors)} sub="Failures & pipeline errors" />
          </div>
        )}

        {!fullLayout && categoriesToolbar(filter, setFilter, logs, view, setView, showViewToggle)}

        <div
          className={clsx(maxHeight && "overflow-y-auto pr-1 scrollbar-thin")}
          style={maxHeight ? { maxHeight } : undefined}
        >
          {feedBody}
        </div>
      </div>
    </div>
  );
}

function categoriesToolbar(
  filter: string,
  setFilter: (v: string) => void,
  logs: ActivityLog[],
  view: "highlights" | "all",
  setView: (v: "highlights" | "all") => void,
  showViewToggle: boolean,
) {
  const categories = ["all", ...new Set(logs.map((l) => l.category))];
  return (
    <div className="mb-4 flex flex-wrap gap-2">
      {showViewToggle && (
        <div className="flex rounded-full border border-white/[0.08] bg-black/30 p-0.5">
          <button
            type="button"
            onClick={() => setView("highlights")}
            className={clsx(
              "rounded-full px-3 py-1 text-xs font-medium",
              view === "highlights" ? "bg-violet-600/40 text-white" : "text-slate-500",
            )}
          >
            Highlights
          </button>
          <button
            type="button"
            onClick={() => setView("all")}
            className={clsx(
              "rounded-full px-3 py-1 text-xs font-medium",
              view === "all" ? "bg-white/12 text-white" : "text-slate-500",
            )}
          >
            All
          </button>
        </div>
      )}
      {categories.map((c) => (
        <button
          key={c}
          type="button"
          onClick={() => setFilter(c)}
          className={clsx(
            "rounded-full px-3 py-1 text-xs capitalize",
            filter === c ? "bg-white/12 text-white" : "bg-white/[0.03] text-slate-500",
          )}
        >
          {c}
        </button>
      ))}
    </div>
  );
}
