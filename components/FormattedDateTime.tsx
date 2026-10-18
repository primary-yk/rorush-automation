"use client";

import { useEffect, useState } from "react";

/** Avoid SSR/client timezone mismatch (WSL vs Windows browser). */
export function FormattedDateTime({ iso }: { iso: string }) {
  const [label, setLabel] = useState(() => iso.replace("T", " ").slice(0, 19));

  useEffect(() => {
    setLabel(new Date(iso).toLocaleString());
  }, [iso]);

  return <span suppressHydrationWarning>{label}</span>;
}
