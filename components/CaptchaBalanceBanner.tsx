"use client";

import clsx from "clsx";
import type { CaptchaBalanceStatus } from "@/lib/api";
import { Card } from "./ui";

export function CaptchaBalanceBanner({ status }: { status: CaptchaBalanceStatus | null }) {
  if (!status?.configured) return null;

  const low = status.lowBalance && status.balanceUsd != null;

  return (
    <Card
      className={clsx(
        "mb-6 border px-4 py-3",
        low ? "border-amber-500/40 bg-amber-500/[0.08]" : "border-emerald-500/20 bg-emerald-500/[0.05]",
      )}
      glow="none"
    >
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <p className="text-sm font-semibold text-slate-100">
            {status.provider ?? "Captcha"} balance
            {status.balanceUsd != null ? (
              <span className="ml-2 font-mono text-emerald-200">${status.balanceUsd.toFixed(2)}</span>
            ) : (
              <span className="ml-2 text-slate-500">—</span>
            )}
          </p>
          <p className="mt-1 text-xs text-slate-500">
            {low
              ? `Below $${status.lowBalanceThresholdUsd.toFixed(2)} — top up before the next rain.`
              : "Rain joins use ~1 solve per account per rain."}
          </p>
          {status.error && <p className="mt-1 text-xs text-rose-300/90">{status.error}</p>}
        </div>
        {low && (
          <span className="rounded-full bg-amber-500/25 px-3 py-1 text-xs font-semibold text-amber-100">
            Low balance
          </span>
        )}
      </div>
    </Card>
  );
}
