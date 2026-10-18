"use client";

import clsx from "clsx";

export function Toggle({
  checked,
  onChange,
  label,
  description,
  disabled,
  compact,
}: {
  checked: boolean;
  onChange: (v: boolean) => void;
  label: string;
  description?: string;
  disabled?: boolean;
  compact?: boolean;
}) {
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={() => onChange(!checked)}
      className={clsx(
        "flex w-full items-start gap-3 rounded-xl border px-3.5 py-3 text-left transition",
        checked
          ? "border-emerald-500/35 bg-emerald-500/[0.08] shadow-[inset_0_1px_0_rgba(255,255,255,0.04)]"
          : "border-white/[0.08] bg-black/25 hover:border-white/15 hover:bg-black/35",
        disabled && "opacity-50",
        compact && "py-2.5",
      )}
      aria-pressed={checked}
    >
      <span
        className={clsx(
          "mt-0.5 h-6 w-10 shrink-0 rounded-full p-0.5 transition-colors",
          checked ? "bg-emerald-500/50" : "bg-slate-700",
        )}
      >
        <span
          className={clsx(
            "block h-5 w-5 rounded-full bg-white shadow-md transition-transform",
            checked ? "translate-x-4" : "translate-x-0",
          )}
        />
      </span>
      <span className="min-w-0">
        <span className="block text-sm font-medium text-slate-100">{label}</span>
        {description && <span className="mt-0.5 block text-xs leading-snug text-slate-500">{description}</span>}
      </span>
    </button>
  );
}
