"use client";

import { useState } from "react";
import { Button, Card, SectionTitle } from "./ui";
import { useToast } from "./Toast";
import { dashboardApi, type PilotBackupFile } from "@/lib/api";

export function BackupRestoreCard() {
  const toast = useToast();
  const [busy, setBusy] = useState<"export" | "import" | null>(null);

  async function exportBackup() {
    setBusy("export");
    try {
      const data = await dashboardApi.exportBackup();
      const blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `rush-pilot-backup-${new Date().toISOString().slice(0, 10)}.json`;
      a.click();
      URL.revokeObjectURL(url);
      toast.push("Backup downloaded.", "success");
    } catch (e) {
      toast.push(e instanceof Error ? e.message : "Export failed", "error");
    } finally {
      setBusy(null);
    }
  }

  async function importBackup(file: File) {
    setBusy("import");
    try {
      const text = await file.text();
      const parsed = JSON.parse(text) as PilotBackupFile;
      const result = await dashboardApi.importBackup(parsed);
      toast.push(
        `Imported ${result.importedAccounts} account(s)${result.skippedDuplicates ? ` · ${result.skippedDuplicates} skipped (duplicate nicknames)` : ""}.`,
        "success",
      );
    } catch (e) {
      toast.push(e instanceof Error ? e.message : "Import failed", "error");
    } finally {
      setBusy(null);
    }
  }

  return (
    <Card glow="violet" className="border-violet-500/15">
      <SectionTitle
        eyebrow="Move to VPS later"
        title="Backup & restore"
        description="Download your pilots and toggles. Passwords stay encrypted — you need the same ENCRYPTION_KEY in .env on the new machine."
      />
      <div className="mt-4 space-y-4 text-sm leading-relaxed text-slate-400">
        <p>
          <strong className="text-slate-200">What the file contains:</strong> account nicknames, join/case/code
          settings, min rain filters, and encrypted login blobs (not plain text).
        </p>
        <p>
          <strong className="text-slate-200">What you still copy manually:</strong>{" "}
          <code className="rounded bg-black/40 px-1 font-mono text-xs">ENCRYPTION_KEY</code> (must match or logins
          won&apos;t decrypt), <code className="rounded bg-black/40 px-1 font-mono text-xs">CAPTCHA_API_KEY</code>, and
          Discord webhook/token if you use them.
        </p>
        <p>
          <strong className="text-slate-200">On a VPS:</strong> install Rush Pilot, paste the same{" "}
          <code className="font-mono text-xs">.env</code>, run <code className="font-mono text-xs">npm run dev</code>,
          then import this file under Settings. You do not need a VPS to export now — save the JSON somewhere safe
          (USB, password manager file vault).
        </p>
      </div>
      <div className="mt-6 flex flex-wrap gap-3">
        <Button disabled={busy != null} onClick={() => void exportBackup()}>
          {busy === "export" ? "Exporting…" : "Download backup"}
        </Button>
        <label className="inline-flex cursor-pointer items-center">
          <input
            type="file"
            accept="application/json,.json"
            className="sr-only"
            disabled={busy != null}
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) void importBackup(f);
              e.target.value = "";
            }}
          />
          <span className="inline-flex min-h-[44px] touch-manipulation items-center rounded-xl border border-white/10 bg-white/5 px-4 text-sm font-medium text-slate-200 hover:bg-white/10">
            {busy === "import" ? "Importing…" : "Import backup file"}
          </span>
        </label>
      </div>
    </Card>
  );
}
