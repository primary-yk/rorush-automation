"use client";

import { useState } from "react";
import { Toggle } from "./Toggle";
import { Button, Card, Input, StatusPill } from "./ui";
import { useToast } from "./Toast";
import { dashboardApi, type Account } from "@/lib/api";
import clsx from "clsx";

function avatarGradient(nickname: string): string {
  let h = 0;
  for (let i = 0; i < nickname.length; i++) h = (h * 31 + nickname.charCodeAt(i)) >>> 0;
  const hues = [265, 290, 320, 190, 210];
  const hue = hues[h % hues.length];
  return `linear-gradient(135deg, hsl(${hue} 70% 45%), hsl(${(hue + 40) % 360} 65% 35%))`;
}

export function AccountCard({ account, onChange }: { account: Account; onChange: () => Promise<void> }) {
  const toast = useToast();
  const [removing, setRemoving] = useState(false);
  const [advancedOpen, setAdvancedOpen] = useState(false);
  const ok = account.status !== "error";

  async function removeAccount() {
    if (
      !window.confirm(
        `Remove "${account.nickname}" from Rush Pilot?\n\nThis does not delete your RoRush site account.`,
      )
    ) {
      return;
    }
    setRemoving(true);
    try {
      await dashboardApi.deleteAccount(account.id);
      toast.push(`Removed ${account.nickname}`, "success");
      await onChange();
    } catch (e) {
      toast.push(e instanceof Error ? e.message : "Could not remove account", "error");
    } finally {
      setRemoving(false);
    }
  }

  const initials = account.nickname
    .split(/\s+/)
    .map((w) => w[0])
    .join("")
    .slice(0, 2)
    .toUpperCase();

  return (
    <Card hover className="overflow-visible">
      <div className="flex flex-wrap items-start gap-4">
        <div
          className="flex h-14 w-14 shrink-0 items-center justify-center rounded-2xl text-lg font-bold text-white shadow-lg"
          style={{ background: avatarGradient(account.nickname) }}
        >
          {initials}
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-start justify-between gap-2">
            <div>
              <h3 className="text-xl font-semibold tracking-tight text-white">{account.nickname}</h3>
              <p className="mt-0.5 text-sm text-slate-400">
                {account.username ?? "Session login"}
              </p>
            </div>
            <StatusPill ok={ok} label={account.status} />
          </div>
          <div className="mt-4 grid grid-cols-3 gap-2 sm:gap-3">
            <StatChip label="Balance" value={account.balance != null ? account.balance.toFixed(2) : "—"} />
            <StatChip label="Level" value={account.level != null ? String(account.level) : "—"} />
            <StatChip
              label="Lifetime"
              value={account.lifetimeEarnings.total.toFixed(2)}
              accent
            />
          </div>
        </div>
      </div>

      {account.lastError && (
        <div className="mt-4 flex flex-wrap items-center justify-between gap-2 rounded-xl border border-rose-500/20 bg-rose-500/10 px-4 py-3">
          <p className="text-sm text-rose-100">{account.lastError}</p>
          <Button
            variant="ghost"
            className="shrink-0 py-1.5 text-xs"
            onClick={async () => {
              await dashboardApi.patchAccount(account.id, { clearError: true });
              toast.push("Alert cleared", "success");
              await onChange();
            }}
          >
            Dismiss
          </Button>
        </div>
      )}

      <div className="mt-6 grid gap-2 sm:grid-cols-3">
        <Toggle
          label="Join rain"
          description="Auto-join chat rains"
          checked={account.joinRain}
          onChange={async (v) => {
            await dashboardApi.patchAccount(account.id, { joinRain: v });
            await onChange();
          }}
        />
        <Toggle
          label="Auto-open cases"
          description="Daily, weekly & monthly"
          checked={account.autoOpenCases}
          onChange={async (v) => {
            await dashboardApi.patchAccount(account.id, { autoOpenCases: v });
            await onChange();
          }}
        />
        <Toggle
          label="Redeem codes"
          description="Discord promos"
          checked={account.autoRedeemCodes}
          onChange={async (v) => {
            await dashboardApi.patchAccount(account.id, { autoRedeemCodes: v });
            await onChange();
          }}
        />
      </div>

      <button
        type="button"
        onClick={() => setAdvancedOpen((v) => !v)}
        className="mt-5 flex w-full items-center justify-between rounded-xl border border-white/[0.06] bg-black/20 px-4 py-3 text-left text-sm text-slate-300 transition hover:border-white/10"
      >
        <span>Limbo wager & filters</span>
        <span className={clsx("text-slate-500 transition", advancedOpen && "rotate-180")}>▾</span>
      </button>

      {advancedOpen && (
        <div className="mt-3 space-y-4 rounded-xl border border-amber-500/15 bg-gradient-to-b from-amber-500/[0.06] to-transparent p-4">
          <p className="text-xs leading-relaxed text-slate-500">
            If rain rejects for wager, Pilot limbos for the rain pool size, then retries — up to 3 tries per rain.
          </p>
          <Toggle
            label="Auto limbo wager"
            description="When rain requires recent play"
            checked={account.limboWagerEnabled}
            onChange={async (v) => {
              await dashboardApi.patchAccount(account.id, { limboWagerEnabled: v });
              await onChange();
            }}
          />
          <div className="grid gap-3 sm:grid-cols-2">
            <label className="text-sm text-slate-400">
              Multiplier (min 1.1×)
              <Input
                type="number"
                step="0.01"
                min={1.1}
                className="mt-1.5"
                defaultValue={account.limboMultiplier}
                onBlur={async (e) => {
                  const v = Math.max(1.1, Number(e.target.value) || 1.1);
                  await dashboardApi.patchAccount(account.id, { limboMultiplier: v });
                  await onChange();
                }}
              />
            </label>
            <label className="text-sm text-slate-400">
              Fallback bet (coins)
              <Input
                type="number"
                step="0.01"
                min={0.01}
                className="mt-1.5"
                defaultValue={account.limboBetCoins}
                onBlur={async (e) => {
                  const v = Math.max(0.01, Number(e.target.value) || 1);
                  await dashboardApi.patchAccount(account.id, { limboBetCoins: v });
                  await onChange();
                }}
              />
            </label>
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            <label className="text-sm text-slate-400">
              Min rain (coins)
              <Input
                type="number"
                step="0.01"
                className="mt-1.5"
                defaultValue={account.minRainAmount}
                onBlur={async (e) => {
                  await dashboardApi.patchAccount(account.id, { minRainAmount: Number(e.target.value) });
                  await onChange();
                }}
              />
            </label>
            <label className="text-sm text-slate-400">
              Min level for codes
              <Input
                type="number"
                className="mt-1.5"
                defaultValue={account.minCodeLevel}
                onBlur={async (e) => {
                  await dashboardApi.patchAccount(account.id, { minCodeLevel: Number(e.target.value) });
                  await onChange();
                }}
              />
            </label>
          </div>
        </div>
      )}

      <Button variant="danger" className="mt-5 w-full sm:w-auto" disabled={removing} onClick={() => void removeAccount()}>
        {removing ? "Removing…" : "Remove from Pilot"}
      </Button>
    </Card>
  );
}

function StatChip({ label, value, accent }: { label: string; value: string; accent?: boolean }) {
  return (
    <div className="rounded-xl border border-white/[0.06] bg-black/25 px-3 py-2.5 text-center">
      <p className="text-[10px] font-medium uppercase tracking-wider text-slate-500">{label}</p>
      <p className={clsx("mt-0.5 text-sm font-semibold tabular-nums", accent ? "text-emerald-300" : "text-white")}>
        {value}
      </p>
    </div>
  );
}
