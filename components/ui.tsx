import clsx from "clsx";
import type { ReactNode } from "react";

export function Card({
  children,
  className,
  glow,
}: {
  children: ReactNode;
  className?: string;
  glow?: "mint" | "violet" | "none";
}) {
  return (
    <div
      className={clsx(
        "relative overflow-hidden rounded-2xl border border-white/[0.08] bg-white/[0.03] p-6 backdrop-blur-md",
        glow === "mint" && "shadow-[0_0_60px_-20px_rgba(110,231,183,0.25)]",
        glow === "violet" && "shadow-[0_0_60px_-20px_rgba(167,139,250,0.2)]",
        className,
      )}
    >
      {children}
    </div>
  );
}

export function SectionTitle({
  eyebrow,
  title,
  description,
}: {
  eyebrow?: string;
  title: string;
  description?: string;
}) {
  return (
    <div className="mb-5">
      {eyebrow && (
        <p className="mb-1 text-xs font-medium uppercase tracking-[0.2em] text-violet-300/80">
          {eyebrow}
        </p>
      )}
      <h2 className="font-display text-xl font-semibold tracking-tight text-white">{title}</h2>
      {description && <p className="mt-2 max-w-prose text-sm leading-relaxed text-slate-400">{description}</p>}
    </div>
  );
}

export function Button({
  children,
  variant = "primary",
  className,
  ...props
}: React.ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: "primary" | "ghost" | "danger";
}) {
  return (
    <button
      type="button"
      className={clsx(
        "inline-flex items-center justify-center rounded-xl px-4 py-2.5 text-sm font-medium transition",
        variant === "primary" &&
          "bg-gradient-to-r from-violet-500 to-fuchsia-500 text-white shadow-lg shadow-violet-500/20 hover:brightness-110",
        variant === "ghost" && "border border-white/10 bg-white/5 text-slate-200 hover:bg-white/10",
        variant === "danger" && "text-rose-400 hover:text-rose-300",
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
        "w-full rounded-xl border border-white/10 bg-black/30 px-3.5 py-2.5 text-sm text-white placeholder:text-slate-500",
        "focus:border-violet-400/50 focus:outline-none focus:ring-2 focus:ring-violet-500/20",
        props.className,
      )}
    />
  );
}

export function StatusPill({ ok, label }: { ok: boolean; label: string }) {
  return (
    <span
      className={clsx(
        "rounded-full px-3 py-1 text-xs font-medium",
        ok ? "bg-emerald-500/15 text-emerald-300" : "bg-rose-500/15 text-rose-300",
      )}
    >
      {label}
    </span>
  );
}
