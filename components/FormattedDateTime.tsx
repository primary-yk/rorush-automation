"use client";

import { useEffect, useState } from "react";

function safeDate(iso: string): Date | null {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? null : d;
}

/** Avoid SSR/client timezone mismatch (WSL vs Windows browser). */
export function FormattedDateTime({ iso }: { iso: string }) {
  const [label, setLabel] = useState(() => iso.replace("T", " ").slice(0, 19));

  useEffect(() => {
    const d = safeDate(iso);
    setLabel(d ? d.toLocaleString() : iso);
  }, [iso]);

  return <span suppressHydrationWarning>{label}</span>;
}

export function FormattedClock({ iso, showSeconds }: { iso: string; showSeconds?: boolean }) {
  const [time, setTime] = useState("--:--");

  useEffect(() => {
    const d = safeDate(iso);
    if (!d) {
      setTime(iso.slice(11, 19) || "--:--");
      return;
    }
    setTime(
      d.toLocaleTimeString(undefined, {
        hour: "2-digit",
        minute: "2-digit",
        second: showSeconds ? "2-digit" : undefined,
      }),
    );
  }, [iso, showSeconds]);

  return (
    <time dateTime={iso} suppressHydrationWarning className="tabular-nums">
      {time}
    </time>
  );
}

export function FormattedDayLabel({ iso }: { iso: string }) {
  const [label, setLabel] = useState(() => iso.slice(0, 10));

  useEffect(() => {
    const d = safeDate(iso);
    if (!d) return;
    const today = new Date();
    const startToday = new Date(today.getFullYear(), today.getMonth(), today.getDate());
    const startThat = new Date(d.getFullYear(), d.getMonth(), d.getDate());
    const diff = (startToday.getTime() - startThat.getTime()) / 86_400_000;
    if (diff === 0) setLabel("Today");
    else if (diff === 1) setLabel("Yesterday");
    else
      setLabel(
        d.toLocaleDateString(undefined, {
          weekday: "long",
          month: "short",
          day: "numeric",
          year: "numeric",
        }),
      );
  }, [iso]);

  return <span suppressHydrationWarning>{label}</span>;
}
