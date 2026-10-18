"use client";

import clsx from "clsx";

export function Toggle({
  checked,
  onChange,
  label,
  disabled,
}: {
  checked: boolean;
  onChange: (v: boolean) => void;
  label: string;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={() => onChange(!checked)}
      className={clsx(
        "flex items-center gap-2 rounded-md border px-3 py-1.5 text-sm transition",
        checked ? "border-accent/40 bg-accent/10 text-accent" : "border-border bg-panel text-muted",
        disabled && "opacity-50",
      )}
      aria-pressed={checked}
    >
      <span
        className={clsx(
          "h-4 w-8 rounded-full p-0.5 transition",
          checked ? "bg-accent/30" : "bg-slate-700",
        )}
      >
        <span
          className={clsx(
            "block h-3 w-3 rounded-full bg-white transition",
            checked ? "translate-x-4" : "translate-x-0",
          )}
        />
      </span>
      {label}
    </button>
  );
}
