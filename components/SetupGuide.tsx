"use client";

import { useState } from "react";
import { Card, SectionTitle } from "./ui";

const STEPS = [
  {
    title: "Install on your PC (Windows)",
    body: (
      <>
        Install <strong>Ubuntu (WSL)</strong> from PowerShell:{" "}
        <code className="rounded bg-black/40 px-1">wsl --install</code>, restart, then open Ubuntu from the Start menu.
        Unzip or clone your copy of Rush Pilot into your home folder (from your purchase — not a public link).
      </>
    ),
  },
  {
    title: "Configure secrets once",
    body: (
      <>
        In the project folder: copy <code className="rounded bg-black/40 px-1">.env.example</code> to{" "}
        <code className="rounded bg-black/40 px-1">.env</code>, set{" "}
        <code className="rounded bg-black/40 px-1">ENCRYPTION_KEY</code> (random 32-byte base64). Optional:{" "}
        <code className="rounded bg-black/40 px-1">CAPMONSTER_API_KEY</code> for rain captchas.
      </>
    ),
  },
  {
    title: "Activate & run",
    body: (
      <>
        Run <code className="rounded bg-black/40 px-1">npm install</code> once, then{" "}
        <code className="rounded bg-black/40 px-1">npm run dev</code> and leave the terminal open. Open{" "}
        <code className="rounded bg-black/40 px-1">http://127.0.0.1:43123</code>, paste your license key, then add
        RoRush accounts below.
      </>
    ),
  },
  {
    title: "Add a RoRush account",
    body: (
      <>
        Nickname plus RoRush email and password (encrypted locally). Turn on Join rain / Auto-open cases per account.
        Turn Global pause off when you want automation running.
      </>
    ),
  },
];

export function SetupGuide({ apiOk }: { apiOk: boolean }) {
  const [open, setOpen] = useState(!apiOk);

  return (
    <Card glow="violet" className="border-violet-500/20">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <SectionTitle
          eyebrow="New here"
          title="Setup checklist"
          description="One-time steps. Keep npm run dev running while you use this page."
        />
        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          className="text-sm text-violet-300 hover:text-violet-200"
        >
          {open ? "Hide" : "Show steps"}
        </button>
      </div>
      {open && (
        <ol className="mt-2 space-y-4">
          {STEPS.map((step, i) => (
            <li key={step.title} className="flex gap-4">
              <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-violet-500/20 text-sm font-semibold text-violet-200">
                {i + 1}
              </span>
              <div>
                <p className="font-medium text-slate-100">{step.title}</p>
                <p className="mt-1 text-sm leading-relaxed text-slate-400">{step.body}</p>
              </div>
            </li>
          ))}
        </ol>
      )}
      <p className="mt-4 text-xs text-slate-500">
        Detailed guides: <code className="text-slate-400">docs/GETTING-STARTED.md</code> ·{" "}
        <code className="text-slate-400">docs/WINDOWS-SETUP.md</code>
      </p>
    </Card>
  );
}
