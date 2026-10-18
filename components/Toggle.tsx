"use client";

import clsx from "clsx";

export function Toggle({
  checked,
  onChange,
  label,
  description,
  disabled,
}: {
  checked: boolean;
  onChange: (v: boolean) => void;
  label: string;
  description?: string;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={() => onChange(!checked)}
      className={clsx(
        "flex w-full items-start gap-3 rounded-xl border px-3 py-2.5 text-left transition sm:w-auto sm:min-w-[160px]",
        checked
          ? "border-emerald-500/30 bg-emerald-500/10"
          : "border-white/10 bg-black/20 hover:border-white/20",
        disabled && "opacity-50",
      )}
      aria-pressed={checked}
    >
      <span
        className={clsx(
          "mt-0.5 h-5 w-9 shrink-0 rounded-full p-0.5 transition",
          checked ? "bg-emerald-500/40" : "bg-slate-600",
        )}
      >
        <span
          className={clsx(
            "block h-4 w-4 rounded-full bg-white shadow transition",
            checked ? "translate-x-4" : "translate-x-0",
          )}
        />
      </span>
      <span>
        <span className="block text-sm font-medium text-slate-100">{label}</span>
        {description && <span className="mt-0.5 block text-xs text-slate-500">{description}</span>}
      </span>
    </button>
  );
}
