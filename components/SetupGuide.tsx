"use client";

import { useState } from "react";
import { Card, SectionTitle, Button } from "./ui";

const STEPS = [
  {
    title: "Install on your PC (Windows)",
    body: (
      <>
        Install <strong className="text-slate-300">Ubuntu (WSL)</strong> from PowerShell:{" "}
        <code className="rounded-md bg-black/50 px-1.5 py-0.5 font-mono text-xs text-violet-200">wsl --install</code>,
        restart, then open Ubuntu. Clone or unzip Rush Pilot into your home folder.
      </>
    ),
  },
  {
    title: "Configure secrets once",
    body: (
      <>
        Copy <code className="rounded-md bg-black/50 px-1.5 py-0.5 font-mono text-xs">.env.example</code> to{" "}
        <code className="rounded-md bg-black/50 px-1.5 py-0.5 font-mono text-xs">.env</code>. Set{" "}
        <code className="font-mono text-xs text-emerald-300/90">ENCRYPTION_KEY</code> and{" "}
        <code className="font-mono text-xs text-emerald-300/90">CAPMONSTER_API_KEY</code> for rain captchas.
      </>
    ),
  },
  {
    title: "Start the app",
    body: (
      <>
        Run <code className="rounded-md bg-black/50 px-1.5 py-0.5 font-mono text-xs">npm install</code> once, then{" "}
        <code className="rounded-md bg-black/50 px-1.5 py-0.5 font-mono text-xs">npm run dev</code>. Open{" "}
        <code className="rounded-md bg-black/50 px-1.5 py-0.5 font-mono text-xs text-sky-300/90">http://127.0.0.1:43123</code>{" "}
        in your browser.
      </>
    ),
  },
  {
    title: "Add a RoRush account",
    body: (
      <>
        Save a nickname and login under <strong className="text-slate-300">Accounts</strong>. Enable Join rain, turn{" "}
        <strong className="text-slate-300">Global pause</strong> off, and watch the Activity tab during the next rain.
      </>
    ),
  },
];

export function SetupGuide({ apiOk, hasAccounts }: { apiOk: boolean; hasAccounts?: boolean }) {
  const [open, setOpen] = useState(!apiOk && !hasAccounts);

  return (
    <Card glow="violet" className="border-violet-500/15">
      <SectionTitle
        eyebrow="New here"
        title="Setup checklist"
        description="One-time steps. Keep npm run dev running while you use the dashboard."
        action={
          <Button variant="ghost" size="sm" onClick={() => setOpen((v) => !v)}>
            {open ? "Hide" : "Show steps"}
          </Button>
        }
      />
      {open && (
        <ol className="mt-2 grid gap-4 sm:grid-cols-2">
          {STEPS.map((step, i) => (
            <li
              key={step.title}
              className="flex gap-4 rounded-xl border border-white/[0.05] bg-black/20 p-4 transition hover:border-white/10"
            >
              <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-gradient-to-br from-violet-500/30 to-fuchsia-500/20 text-sm font-bold text-violet-100">
                {i + 1}
              </span>
              <div>
                <p className="font-medium text-slate-100">{step.title}</p>
                <p className="mt-1.5 text-sm leading-relaxed text-slate-400">{step.body}</p>
              </div>
            </li>
          ))}
        </ol>
      )}
      <p className="mt-4 text-xs text-slate-600">
        Docs: <code className="text-slate-500">docs/GETTING-STARTED.md</code> ·{" "}
        <code className="text-slate-500">docs/WINDOWS-SETUP.md</code>
      </p>
    </Card>
  );
}
