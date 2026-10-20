"use client";

import { useCallback, useEffect, useState } from "react";
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

export function AccountCard({
  account,
  onAccountUpdate,
  onRemove,
}: {
  account: Account;
  onAccountUpdate: (account: Account) => void;
  onRemove: (id: number) => void;
}) {
  const toast = useToast();
  const [local, setLocal] = useState(account);
  const [removing, setRemoving] = useState(false);
  const [advancedOpen, setAdvancedOpen] = useState(false);
  const [pending, setPending] = useState<string | null>(null);
  const [testLimboBet, setTestLimboBet] = useState("1");
  const [testLimboRunning, setTestLimboRunning] = useState(false);

  useEffect(() => {
    setLocal(account);
  }, [account]);

  const ok = local.status !== "error";

  const applyPatch = useCallback(
    async (key: string, optimistic: Partial<Account>, body: Record<string, unknown>) => {
      setPending(key);
      let rollback: Account | null = null;
      setLocal((cur) => {
        rollback = cur;
        return { ...cur, ...optimistic };
      });
      try {
        const updated = await dashboardApi.patchAccount(account.id, body);
        onAccountUpdate(updated);
        setLocal(updated);
      } catch (e) {
        if (rollback) setLocal(rollback);
        toast.push(e instanceof Error ? e.message : "Update failed", "error");
      } finally {
        setPending(null);
      }
    },
    [account.id, onAccountUpdate, toast],
  );

  async function removeAccount() {
    if (
      !window.confirm(
        `Remove "${local.nickname}" from Rush Pilot?\n\nThis does not delete your RoRush site account.`,
      )
    ) {
      return;
    }
    setRemoving(true);
    try {
      await dashboardApi.deleteAccount(local.id);
      toast.push(`Removed ${local.nickname}`, "success");
      onRemove(local.id);
    } catch (e) {
      toast.push(e instanceof Error ? e.message : "Could not remove account", "error");
    } finally {
      setRemoving(false);
    }
  }

  const initials = local.nickname
    .split(/\s+/)
    .map((w) => w[0])
    .join("")
    .slice(0, 2)
    .toUpperCase();

  const busy = pending != null;

  return (
    <Card className="overflow-visible">
      <div className="flex flex-wrap items-start gap-4">
        <div
          className="flex h-14 w-14 shrink-0 items-center justify-center rounded-2xl text-lg font-bold text-white shadow-lg"
          style={{ background: avatarGradient(local.nickname) }}
        >
          {initials}
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-start justify-between gap-2">
            <div>
              <h3 className="text-xl font-semibold tracking-tight text-white">{local.nickname}</h3>
              <p className="mt-0.5 text-sm text-slate-400">
                {local.username ?? "Session login"}
                {local.ownerDiscordId ? (
                  <span className="text-slate-500"> · Discord friend</span>
                ) : (
                  <span className="text-slate-500"> · Host dashboard</span>
                )}
              </p>
            </div>
            <StatusPill ok={ok} label={local.status} />
          </div>
          <div className="mt-4 grid grid-cols-3 gap-2 sm:gap-3">
            <StatChip label="Balance" value={local.balance != null ? local.balance.toFixed(2) : "—"} />
            <StatChip label="Level" value={local.level != null ? String(local.level) : "—"} />
            <StatChip label="Earned" value={local.lifetimeEarnings.total.toFixed(2)} accent />
          </div>
        </div>
      </div>

      {local.lastError && (
        <div className="mt-4 flex flex-wrap items-center justify-between gap-2 rounded-xl border border-rose-500/20 bg-rose-500/10 px-4 py-3">
          <p className="min-w-0 flex-1 text-sm text-rose-100">{local.lastError}</p>
          <Button
            variant="ghost"
            className="shrink-0 touch-manipulation py-1.5 text-xs"
            disabled={pending === "dismiss"}
            onClick={() =>
              void applyPatch("dismiss", { lastError: null, status: "idle" }, { clearError: true })
            }
          >
            {pending === "dismiss" ? "…" : "Dismiss"}
          </Button>
        </div>
      )}

      <div className={clsx("mt-6 grid gap-2 sm:grid-cols-3", busy && "pointer-events-none opacity-90")}>
        <Toggle
          label="Join rain"
          description="Auto-join chat rains"
          checked={local.joinRain}
          pending={pending === "joinRain"}
          onChange={(v) => void applyPatch("joinRain", { joinRain: v }, { joinRain: v })}
        />
        <Toggle
          label="Auto-open cases"
          description="Daily, weekly & monthly"
          checked={local.autoOpenCases}
          pending={pending === "autoOpenCases"}
          onChange={(v) => void applyPatch("autoOpenCases", { autoOpenCases: v }, { autoOpenCases: v })}
        />
        <Toggle
          label="Redeem codes"
          description="Discord promos"
          checked={local.autoRedeemCodes}
          pending={pending === "autoRedeemCodes"}
          onChange={(v) => void applyPatch("autoRedeemCodes", { autoRedeemCodes: v }, { autoRedeemCodes: v })}
        />
      </div>

      <button
        type="button"
        onClick={() => setAdvancedOpen((v) => !v)}
        className="mt-5 flex w-full touch-manipulation items-center justify-between rounded-xl border border-white/[0.06] bg-black/20 px-4 py-3 text-left text-sm text-slate-300 transition hover:border-white/10"
      >
        <span>Limbo wager & filters</span>
        <span className={clsx("text-slate-500 transition", advancedOpen && "rotate-180")}>▾</span>
      </button>

      {advancedOpen && (
        <div className="mt-3 space-y-4 rounded-xl border border-amber-500/15 bg-gradient-to-b from-amber-500/[0.06] to-transparent p-4">
          <p className="text-xs leading-relaxed text-slate-500">
            After rain pays out, auto-limbo wagers <strong className="font-medium text-slate-400">only what you earned</strong>{" "}
            from that rain — not your existing balance. If join fails for wager, limbo uses pool size then retries.
          </p>
          <Toggle
            label="Auto limbo wager"
            description="When rain requires recent play"
            checked={local.limboWagerEnabled}
            pending={pending === "limboWagerEnabled"}
            onChange={(v) =>
              void applyPatch("limboWagerEnabled", { limboWagerEnabled: v }, { limboWagerEnabled: v })
            }
          />
          <div className="grid gap-3 sm:grid-cols-2">
            <label className="text-sm text-slate-400">
              Multiplier (min 1.1×)
              <Input
                type="number"
                step="0.01"
                min={1.1}
                className="mt-1.5"
                defaultValue={local.limboMultiplier}
                disabled={busy}
                onBlur={async (e) => {
                  const v = Math.max(1.1, Number(e.target.value) || 1.1);
                  await applyPatch("limboMultiplier", { limboMultiplier: v }, { limboMultiplier: v });
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
                defaultValue={local.limboBetCoins}
                disabled={busy}
                onBlur={async (e) => {
                  const v = Math.max(0.01, Number(e.target.value) || 1);
                  await applyPatch("limboBetCoins", { limboBetCoins: v }, { limboBetCoins: v });
                }}
              />
            </label>
          </div>
          <div className="rounded-lg border border-violet-500/20 bg-violet-500/5 p-3">
            <p className="text-xs font-medium text-violet-200/90">Test limbo</p>
            <p className="mt-1 text-xs text-slate-500">Manual bet to verify SignalR + captcha-free limbo on this account.</p>
            <div className="mt-3 flex flex-wrap items-end gap-2">
              <label className="min-w-[7rem] flex-1 text-sm text-slate-400">
                Bet (coins)
                <Input
                  type="number"
                  step="0.01"
                  min={0.01}
                  className="mt-1.5"
                  value={testLimboBet}
                  disabled={testLimboRunning || busy}
                  onChange={(e) => setTestLimboBet(e.target.value)}
                />
              </label>
              <Button
                variant="soft"
                disabled={testLimboRunning || busy}
                onClick={async () => {
                  const bet = Number(testLimboBet);
                  if (!Number.isFinite(bet) || bet < 0.01) {
                    toast.push("Enter a bet of at least 0.01", "error");
                    return;
                  }
                  setTestLimboRunning(true);
                  try {
                    const r = await dashboardApi.testLimbo(account.id, {
                      betCoins: bet,
                      multiplier: local.limboMultiplier,
                    });
                    toast.push(
                      `Limbo ${r.hit ? "hit" : "miss"} · ${r.betCoins.toFixed(2)} coins`,
                      r.hit ? "success" : "info",
                    );
                    const refreshed = await dashboardApi.refreshAccountStats();
                    const updated = refreshed.accounts.find((a) => a.id === account.id);
                    if (updated) {
                      onAccountUpdate(updated);
                      setLocal(updated);
                    }
                  } catch (e) {
                    toast.push(e instanceof Error ? e.message : "Test limbo failed", "error");
                  } finally {
                    setTestLimboRunning(false);
                  }
                }}
              >
                {testLimboRunning ? "Playing…" : "Test limbo"}
              </Button>
            </div>
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            <label className="text-sm text-slate-400">
              Min rain (coins)
              <Input
                type="number"
                step="0.01"
                className="mt-1.5"
                defaultValue={local.minRainAmount}
                disabled={busy}
                onBlur={async (e) => {
                  const v = Number(e.target.value);
                  await applyPatch("minRainAmount", { minRainAmount: v }, { minRainAmount: v });
                }}
              />
            </label>
            <label className="text-sm text-slate-400">
              Min level for codes
              <Input
                type="number"
                className="mt-1.5"
                defaultValue={local.minCodeLevel}
                disabled={busy}
                onBlur={async (e) => {
                  const v = Number(e.target.value);
                  await applyPatch("minCodeLevel", { minCodeLevel: v }, { minCodeLevel: v });
                }}
              />
            </label>
          </div>
        </div>
      )}

      <Button
        variant="danger"
        className="mt-5 w-full touch-manipulation sm:w-auto"
        disabled={removing}
        onClick={() => void removeAccount()}
      >
        {removing ? "Removing…" : "Remove from Pilot"}
      </Button>
    </Card>
  );
}

function StatChip({ label, value, accent }: { label: string; value: string; accent?: boolean }) {
  return (
    <div
      className="rounded-xl border border-white/[0.06] bg-black/25 px-3 py-2.5 text-center select-none"
      aria-hidden
    >
      <p className="text-[10px] font-medium uppercase tracking-wider text-slate-500">{label}</p>
      <p className={clsx("mt-0.5 text-sm font-semibold tabular-nums", accent ? "text-emerald-300" : "text-white")}>
        {value}
      </p>
    </div>
  );
}
