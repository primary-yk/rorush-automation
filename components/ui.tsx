import clsx from "clsx";
import type { ReactNode } from "react";

export function Card({
  children,
  className,
  glow,
  hover,
  padding = "default",
}: {
  children: ReactNode;
  className?: string;
  glow?: "mint" | "violet" | "cyan" | "none";
  hover?: boolean;
  padding?: "default" | "none" | "lg";
}) {
  return (
    <div
      className={clsx(
        "relative overflow-hidden rounded-2xl border border-violet-500/15 bg-gradient-to-b from-violet-500/[0.09] via-black/50 to-black/70 shadow-xl shadow-black/60 backdrop-blur-xl shadow-vibe-inner",
        padding === "default" && "p-6",
        padding === "lg" && "p-8",
        padding === "none" && "p-0",
        glow === "mint" && "shadow-glow-mint",
        glow === "violet" && "shadow-glow-violet",
        glow === "cyan" && "shadow-glow-cyan",
        hover && "transition duration-300 hover:border-white/12 hover:shadow-2xl hover:shadow-black/40",
        className,
      )}
    >
      <div className="pointer-events-none absolute inset-0 z-0 bg-[radial-gradient(ellipse_at_top_right,rgba(139,92,246,0.08),transparent_55%)]" />
      <div className="relative z-10">{children}</div>
    </div>
  );
}

export function SectionTitle({
  eyebrow,
  title,
  description,
  action,
}: {
  eyebrow?: string;
  title: string;
  description?: string;
  action?: ReactNode;
}) {
  return (
    <div className="mb-6 flex flex-wrap items-end justify-between gap-4">
      <div>
        {eyebrow && (
          <p className="mb-1.5 text-[11px] font-semibold uppercase tracking-[0.22em] text-violet-300/90">
            {eyebrow}
          </p>
        )}
        <h2 className="font-display text-2xl font-semibold tracking-tight text-white">{title}</h2>
        {description && <p className="mt-2 max-w-prose text-sm leading-relaxed text-slate-400">{description}</p>}
      </div>
      {action}
    </div>
  );
}

export function Button({
  children,
  variant = "primary",
  size = "md",
  className,
  ...props
}: React.ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: "primary" | "ghost" | "danger" | "soft";
  size?: "md" | "sm" | "lg";
}) {
  return (
    <button
      type="button"
      className={clsx(
        "inline-flex touch-manipulation items-center justify-center font-medium transition disabled:cursor-not-allowed disabled:opacity-50",
        size === "sm" && "rounded-lg px-3 py-2 text-xs",
        size === "md" && "rounded-xl px-4 py-2.5 text-sm",
        size === "lg" && "rounded-xl px-5 py-3 text-base",
        variant === "primary" &&
          "bg-gradient-to-r from-violet-500 via-fuchsia-500 to-violet-600 text-white shadow-lg shadow-violet-600/30 hover:brightness-110 active:scale-[0.98]",
        variant === "ghost" &&
          "border border-white/10 bg-white/[0.04] text-slate-200 hover:border-white/20 hover:bg-white/10",
        variant === "soft" &&
          "bg-violet-500/15 text-violet-100 hover:bg-violet-500/25",
        variant === "danger" &&
          "border border-rose-500/25 bg-rose-500/10 text-rose-200 hover:bg-rose-500/20 active:scale-[0.98]",
        className,
      )}
      {...props}
    >
      {children}
    </button>
  );
}

export function Input(props: React.InputHTMLAttributes<HTMLInputElement>) {
  return (
    <input
      {...props}
      className={clsx(
        "w-full rounded-xl border border-white/10 bg-black/40 px-3.5 py-2.5 text-sm text-white placeholder:text-slate-600",
        "transition focus:border-violet-400/60 focus:outline-none focus:ring-2 focus:ring-violet-500/25",
        props.className,
      )}
    />
  );
}

export function StatusPill({ ok, label }: { ok: boolean; label: string }) {
  return (
    <span
      className={clsx(
        "rounded-full px-3 py-1 text-xs font-semibold capitalize tracking-wide",
        ok ? "bg-emerald-500/15 text-emerald-300 ring-1 ring-emerald-500/20" : "bg-rose-500/15 text-rose-300 ring-1 ring-rose-500/20",
      )}
    >
      {label}
    </span>
  );
}

export function MetricCard({
  label,
  value,
  sub,
  icon,
  trend,
}: {
  label: string;
  value: string;
  sub?: string;
  icon?: ReactNode;
  trend?: "up" | "neutral";
}) {
  return (
    <Card padding="default" hover className="!p-5">
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-500">{label}</p>
          <p className="mt-2 font-display text-3xl font-bold tabular-nums tracking-tight text-white">{value}</p>
          {sub && (
            <p className={clsx("mt-1 text-xs", trend === "up" ? "text-emerald-400/90" : "text-slate-500")}>{sub}</p>
          )}
        </div>
        {icon && (
          <div className="flex h-11 w-11 items-center justify-center rounded-xl bg-white/[0.06] text-violet-300">
            {icon}
          </div>
        )}
      </div>
    </Card>
  );
}
