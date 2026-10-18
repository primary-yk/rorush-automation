"use client";

import { useState } from "react";
import { Button, Card, Input } from "./ui";
import { dashboardApi, type LicenseStatus } from "@/lib/api";

export function LicenseGate({
  initial,
  onActivated,
}: {
  initial: LicenseStatus | null;
  onActivated: (status: LicenseStatus) => void;
}) {
  const [key, setKey] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(initial?.message ?? null);

  async function submit() {
    if (!key.trim()) return;
    setBusy(true);
    setError(null);
    try {
      const status = await dashboardApi.activateLicense(key.trim());
      onActivated(status);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="flex min-h-screen items-center justify-center px-4 py-16">
      <div className="w-full max-w-md">
        <div className="mb-8 text-center">
          <p className="text-xs font-medium uppercase tracking-[0.2em] text-violet-300/80">Rush Pilot</p>
          <h1 className="mt-2 font-display text-3xl font-bold text-white">Activate your license</h1>
          <p className="mt-3 text-sm leading-relaxed text-slate-400">
            Paste the key from your purchase email. It stays on this machine only — we never see your RoRush passwords
            or license key on any public server.
          </p>
        </div>
        <Card glow="violet" className="border-violet-500/25">
          <label className="block text-sm font-medium text-slate-200">License key</label>
          <Input
            className="mt-2 font-mono text-xs"
            placeholder="RP1.…"
            value={key}
            onChange={(e) => setKey(e.target.value)}
            autoComplete="off"
          />
          {error && <p className="mt-3 text-sm text-rose-300">{error}</p>}
          <Button className="mt-4 w-full" disabled={busy || !key.trim()} onClick={() => void submit()}>
            {busy ? "Checking…" : "Unlock dashboard"}
          </Button>
          <p className="mt-4 text-center text-xs text-slate-500">
            Need a key? Contact the seller — not RoRush support.
          </p>
        </Card>
      </div>
    </main>
  );
}
