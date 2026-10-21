"use client";

import { useCallback, useEffect, useState } from "react";
import { Button } from "./ui";
import { useToast } from "./Toast";
import { dashboardApi } from "@/lib/api";

type Slot = "daily" | "weekly" | "monthly";

type SlotRow = {
  slot: Slot;
  label: string;
  caseId: string | null;
  isAvailable: boolean;
  unlockAt: string | null;
};

export function RewardCasesPanel({ accountId, disabled }: { accountId: number; disabled?: boolean }) {
  const toast = useToast();
  const [slots, setSlots] = useState<SlotRow[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [opening, setOpening] = useState<Slot | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await dashboardApi.getRewardCases(accountId);
      setSlots(res.slots);
    } catch (e) {
      toast.push(e instanceof Error ? e.message : "Could not load reward cases", "error");
      setSlots(null);
    } finally {
      setLoading(false);
    }
  }, [accountId, toast]);

  useEffect(() => {
    void load();
  }, [load]);

  async function openSlot(slot: Slot) {
    setOpening(slot);
    try {
      const res = await dashboardApi.openRewardCase(accountId, slot);
      const item = res.items[0];
      const label = item
        ? `${item.name}${item.priceCoins != null ? ` · ${item.priceCoins.toFixed(2)} coins` : ""}`
        : `${res.rewardCoins.toFixed(2)} coins`;
      toast.push(`${res.slot} case: ${label}`, "success");
      await load();
      const refreshed = await dashboardApi.refreshAccountStats();
      void refreshed;
    } catch (e) {
      toast.push(e instanceof Error ? e.message : "Case open failed", "error");
    } finally {
      setOpening(null);
    }
  }

  return (
    <div className="rounded-lg border border-amber-500/20 bg-amber-500/5 p-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-xs font-medium text-amber-200/90">Daily / weekly / monthly cases</p>
        <Button variant="ghost" className="py-1 text-xs" disabled={loading || disabled} onClick={() => void load()}>
          {loading ? "…" : "Refresh"}
        </Button>
      </div>
      <p className="mt-1 text-xs text-slate-500">
        Manual open uses the same SignalR flow as auto-open. Wins post to Discord private feed when configured.
      </p>
      <div className="mt-3 grid gap-2 sm:grid-cols-3">
        {(slots ?? []).map((row) => {
          const busy = opening === row.slot || disabled;
          const ready = row.isAvailable && !!row.caseId;
          return (
            <div
              key={row.slot}
              className="rounded-lg border border-white/[0.06] bg-black/25 px-3 py-2.5 text-center"
            >
              <p className="text-[10px] font-semibold uppercase tracking-wider text-slate-500">{row.label}</p>
              <p className="mt-1 text-xs text-slate-400">
                {ready ? "Ready" : row.unlockAt ? `Unlocks ${row.unlockAt.slice(11, 16)} UTC` : "Not ready"}
              </p>
              <Button
                variant="soft"
                className="mt-2 w-full touch-manipulation py-1.5 text-xs"
                disabled={!ready || busy}
                onClick={() => void openSlot(row.slot)}
              >
                {opening === row.slot ? "Opening…" : "Open"}
              </Button>
            </div>
          );
        })}
      </div>
    </div>
  );
}
