"use client";

import clsx from "clsx";
import type { ReactNode } from "react";
import { PrivacyEmailToggle } from "./PrivacyBlur";
import { IconActivity, IconGrid, IconLogo, IconSettings, IconUsers } from "./icons";

export type DashboardTab = "overview" | "accounts" | "activity" | "settings";

const NAV: { id: DashboardTab; label: string; hint: string; Icon: typeof IconGrid }[] = [
  { id: "overview", label: "Overview", hint: "Stats & pulse", Icon: IconGrid },
  { id: "accounts", label: "Accounts", hint: "Pilots & toggles", Icon: IconUsers },
  { id: "activity", label: "Timeline", hint: "Engine events", Icon: IconActivity },
  { id: "settings", label: "Settings", hint: "Discord & privacy", Icon: IconSettings },
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
      <div className="pointer-events-none fixed left-0 top-0 hidden h-[420px] w-[420px] rounded-full bg-violet-600/20 blur-[120px] lg:block" />

      <aside className="glass-panel fixed inset-y-0 left-0 z-40 hidden w-[18rem] flex-col border-r border-violet-500/20 bg-gradient-to-b from-[#050208] via-[#07050f] to-black lg:flex">
        <div className="border-b border-white/[0.06] px-5 py-6">
          <div className="flex items-center gap-3">
            <div className="relative">
              <div className="absolute inset-0 rounded-xl bg-violet-500/40 blur-md" />
              <div className="relative flex h-11 w-11 items-center justify-center rounded-xl bg-gradient-to-br from-violet-500 to-fuchsia-700 shadow-glow-violet">
                <IconLogo className="h-6 w-6 text-white" />
              </div>
            </div>
            <div>
              <p className="font-display text-base font-bold tracking-tight text-gradient-hero">Rush Pilot</p>
              <p className="text-[11px] text-slate-500">Self-hosted RoRush</p>
            </div>
          </div>
        </div>
        <nav className="flex-1 space-y-1.5 p-3">
          {NAV.map(({ id, label, hint, Icon }) => {
            const active = tab === id;
            return (
              <button
                key={id}
                type="button"
                onClick={() => onTab(id)}
                className={clsx(
                  "group relative flex w-full items-center gap-3 overflow-hidden rounded-xl px-3 py-3 text-left transition",
                  active
                    ? "bg-gradient-to-r from-violet-600/30 to-violet-900/10 text-white shadow-vibe-inner ring-1 ring-violet-400/30"
                    : "text-slate-400 hover:bg-violet-500/10 hover:text-violet-50",
                )}
              >
                {active && (
                  <span className="absolute left-0 top-2 bottom-2 w-1 rounded-r-full bg-gradient-to-b from-violet-300 to-fuchsia-500" />
                )}
                <Icon className={clsx("h-5 w-5 shrink-0", active ? "text-violet-200" : "text-slate-500 group-hover:text-violet-300")} />
                <span className="min-w-0">
                  <span className="block text-sm font-semibold">{label}</span>
                  <span className="block truncate text-[10px] text-slate-500 group-hover:text-slate-400">{hint}</span>
                </span>
              </button>
            );
          })}
        </nav>
        <div className="border-t border-white/[0.06] p-4">
          <div className="flex items-center gap-3 rounded-xl border border-white/[0.06] bg-black/40 px-3 py-3">
            <span
              className={clsx(
                "relative h-3 w-3 rounded-full",
                engineOnline ? "bg-emerald-400" : "bg-rose-400",
              )}
            >
              <span
                className={clsx(
                  "absolute inset-0 animate-ping rounded-full opacity-40",
                  engineOnline ? "bg-emerald-400" : "bg-rose-400",
                )}
              />
            </span>
            <div>
              <p className="text-xs font-medium text-slate-200">Engine {engineOnline ? "online" : "offline"}</p>
              <p className="text-[10px] text-slate-500">Automation worker</p>
            </div>
          </div>
        </div>
      </aside>

      <div className="flex min-h-screen flex-1 flex-col lg:pl-[18rem]">
        <header className="glass-panel sticky top-0 z-30 border-b border-violet-500/15 bg-black/70 px-4 py-4 sm:px-6">
          <div className="mx-auto flex max-w-7xl flex-wrap items-center justify-between gap-4">
            <div className="flex items-center gap-3 lg:hidden">
              <IconLogo className="h-7 w-7" />
              <span className="font-display font-semibold text-white">Rush Pilot</span>
              <span className={clsx("h-2 w-2 rounded-full", engineOnline ? "bg-emerald-400" : "bg-rose-400")} />
            </div>
            <div className="ml-auto flex flex-wrap items-center justify-end gap-2">
              <PrivacyEmailToggle compact />
              {headerExtra}
            </div>
          </div>
          <nav className="mx-auto mt-4 flex max-w-7xl gap-1.5 overflow-x-auto pb-0.5 lg:hidden">
            {NAV.map(({ id, label, Icon }) => (
              <button
                key={id}
                type="button"
                onClick={() => onTab(id)}
                className={clsx(
                  "flex shrink-0 items-center gap-2 rounded-full px-4 py-2 text-xs font-semibold transition",
                  tab === id
                    ? "bg-gradient-to-r from-violet-600/50 to-fuchsia-600/30 text-white ring-1 ring-violet-400/35"
                    : "text-slate-500 hover:text-violet-200",
                )}
              >
                <Icon className="h-4 w-4" />
                {label}
              </button>
            ))}
          </nav>
        </header>

        <main className="mx-auto w-full max-w-7xl flex-1 px-4 py-8 sm:px-6 sm:py-10 animate-fade-in">{children}</main>

        <footer className="border-t border-violet-500/10 px-6 py-8 text-center text-xs text-slate-600">
          Self-hosted · Unaffiliated with RoRush · Use at your own risk
        </footer>
      </div>
    </div>
  );
}
