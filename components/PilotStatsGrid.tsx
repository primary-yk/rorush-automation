"use client";

import { MetricCard } from "./ui";
import { IconBolt, IconRain } from "./icons";
import type { PilotStats } from "@/lib/api";

export function PilotStatsGrid({ stats }: { stats: PilotStats }) {
  const rate =
    stats.rainJoins7d > 0
      ? `${Math.round((stats.rainJoinsOk7d / stats.rainJoins7d) * 100)}%`
      : "—";

  return (
    <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
      <MetricCard
        label="Rain joins (7d)"
        value={String(stats.rainJoinsOk7d)}
        sub={`${stats.rainJoinsFail7d} failed · ${rate} success`}
        trend={stats.rainJoinsOk7d > 0 ? "up" : undefined}
        icon={<IconRain className="h-5 w-5" />}
      />
      <MetricCard
        label="Avg captcha (7d)"
        value={stats.avgCaptchaSec7d != null ? `${stats.avgCaptchaSec7d.toFixed(0)}s` : "—"}
        sub="From Rain captcha ready logs"
        icon={<IconRain className="h-5 w-5" />}
      />
      <MetricCard
        label="Lifetime rain"
        value={stats.lifetimeRainCoins.toFixed(2)}
        sub="All accounts · tracked payouts"
        trend="up"
        icon={<IconBolt className="h-5 w-5" />}
      />
      <MetricCard
        label="Last join attempt"
        value={
          stats.lastRainJoinAt
            ? new Date(stats.lastRainJoinAt).toLocaleDateString(undefined, {
                month: "short",
                day: "numeric",
              })
            : "—"
        }
        sub={
          stats.lastRainJoinAt
            ? new Date(stats.lastRainJoinAt).toLocaleTimeString(undefined, {
                hour: "2-digit",
                minute: "2-digit",
              })
            : "No joins yet"
        }
        icon={<IconRain className="h-5 w-5" />}
      />
    </div>
  );
}
