"use client";

import clsx from "clsx";
import type { ReactNode } from "react";
import { IconActivity, IconGrid, IconLogo, IconSettings, IconUsers } from "./icons";

export type DashboardTab = "overview" | "accounts" | "activity" | "settings";

const NAV: { id: DashboardTab; label: string; Icon: typeof IconGrid }[] = [
  { id: "overview", label: "Overview", Icon: IconGrid },
  { id: "accounts", label: "Accounts", Icon: IconUsers },
  { id: "activity", label: "Activity", Icon: IconActivity },
  { id: "settings", label: "Settings", Icon: IconSettings },
];

export function AppShell({
  tab,
  onTab,
  engineOnline,
  children,
  headerExtra,
}: {
  tab: DashboardTab;
  onTab: (t: DashboardTab) => void;
  engineOnline: boolean;
  children: ReactNode;
  headerExtra?: ReactNode;
}) {
  return (
    <div className="relative min-h-screen lg:flex">
      <aside className="glass-panel fixed inset-y-0 left-0 z-40 hidden w-64 flex-col border-r border-white/[0.06] lg:flex">
        <div className="flex items-center gap-3 border-b border-white/[0.06] px-5 py-5">
          <IconLogo />
          <div>
            <p className="text-sm font-semibold tracking-tight text-white">Rush Pilot</p>
            <p className="text-[11px] text-slate-500">RoRush automation</p>
          </div>
        </div>
        <nav className="flex-1 space-y-1 p-3">
          {NAV.map(({ id, label, Icon }) => (
            <button
              key={id}
              type="button"
              onClick={() => onTab(id)}
              className={clsx(
                "flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-medium transition",
                tab === id
                  ? "bg-white/10 text-white shadow-inner shadow-white/5"
                  : "text-slate-400 hover:bg-white/[0.04] hover:text-slate-200",
              )}
            >
              <Icon className={tab === id ? "text-violet-300" : undefined} />
              {label}
            </button>
          ))}
        </nav>
        <div className="border-t border-white/[0.06] p-4">
          <div className="flex items-center gap-2 rounded-xl bg-black/30 px-3 py-2.5">
            <span
              className={clsx(
                "h-2.5 w-2.5 rounded-full",
                engineOnline
                  ? "bg-emerald-400 shadow-[0_0_10px_rgba(52,211,153,0.9)]"
                  : "bg-rose-400 shadow-[0_0_10px_rgba(251,113,133,0.6)]",
              )}
            />
            <span className="text-xs text-slate-400">Engine {engineOnline ? "online" : "offline"}</span>
          </div>
        </div>
      </aside>

      <div className="flex min-h-screen flex-1 flex-col lg:pl-64">
        <header className="glass-panel sticky top-0 z-30 border-b border-white/[0.06] px-4 py-4 sm:px-6">
          <div className="mx-auto flex max-w-5xl flex-wrap items-center justify-between gap-4">
            <div className="flex items-center gap-3 lg:hidden">
              <IconLogo className="h-7 w-7" />
              <span className="font-semibold text-white">Rush Pilot</span>
              <span
                className={clsx(
                  "h-2 w-2 rounded-full",
                  engineOnline ? "bg-emerald-400" : "bg-rose-400",
                )}
              />
            </div>
            {headerExtra}
          </div>
          <nav className="mx-auto mt-4 flex max-w-5xl gap-1 overflow-x-auto pb-0.5 lg:hidden">
            {NAV.map(({ id, label, Icon }) => (
              <button
                key={id}
                type="button"
                onClick={() => onTab(id)}
                className={clsx(
                  "flex shrink-0 items-center gap-2 rounded-full px-4 py-2 text-xs font-medium transition",
                  tab === id ? "bg-violet-500/25 text-violet-100" : "text-slate-500 hover:text-slate-300",
                )}
              >
                <Icon className="h-4 w-4" />
                {label}
              </button>
            ))}
          </nav>
        </header>

        <main className="mx-auto w-full max-w-5xl flex-1 px-4 py-8 sm:px-6 sm:py-10 animate-fade-in">{children}</main>

        <footer className="border-t border-white/[0.04] px-6 py-8 text-center text-xs text-slate-600">
          Self-hosted · Unaffiliated with RoRush · Use at your own risk
        </footer>
      </div>
    </div>
  );
}
