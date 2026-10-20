"use client";

import clsx from "clsx";
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import { Button } from "./ui";

const STORAGE_KEY = "rush-pilot-blur-emails";

const EMAIL_RE = /\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}\b/g;

type PrivacyCtx = {
  blurEmails: boolean;
  setBlurEmails: (v: boolean) => void;
  toggleBlurEmails: () => void;
};

const Ctx = createContext<PrivacyCtx | null>(null);

export function PrivacyBlurProvider({ children }: { children: ReactNode }) {
  const [blurEmails, setBlurEmailsState] = useState(true);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (raw === "0" || raw === "false") setBlurEmailsState(false);
      else setBlurEmailsState(true);
    } catch {
      /* ignore */
    }
    setReady(true);
  }, []);

  const setBlurEmails = useCallback((v: boolean) => {
    setBlurEmailsState(v);
    try {
      localStorage.setItem(STORAGE_KEY, v ? "1" : "0");
    } catch {
      /* ignore */
    }
  }, []);

  const toggleBlurEmails = useCallback(() => {
    setBlurEmailsState((prev) => {
      const next = !prev;
      try {
        localStorage.setItem(STORAGE_KEY, next ? "1" : "0");
      } catch {
        /* ignore */
      }
      return next;
    });
  }, []);

  const value = useMemo(
    () => ({ blurEmails: ready ? blurEmails : true, setBlurEmails, toggleBlurEmails }),
    [blurEmails, ready, setBlurEmails, toggleBlurEmails],
  );

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function usePrivacyBlur(): PrivacyCtx {
  const ctx = useContext(Ctx);
  if (!ctx) {
    return {
      blurEmails: true,
      setBlurEmails: () => undefined,
      toggleBlurEmails: () => undefined,
    };
  }
  return ctx;
}

export function SensitiveText({
  text,
  className,
  revealOnHover = true,
}: {
  text: string;
  className?: string;
  revealOnHover?: boolean;
}) {
  const { blurEmails } = usePrivacyBlur();
  const trimmed = text.trim();
  const looksEmail = EMAIL_RE.test(trimmed);

  if (!blurEmails || !looksEmail) {
    return <span className={className}>{text}</span>;
  }

  return (
    <span
      className={clsx(
        className,
        "inline-block rounded-md bg-violet-500/10 px-1.5 py-0.5 font-mono text-sm text-violet-100/90",
        revealOnHover && "blur-[5px] transition hover:blur-none focus-within:blur-none",
        !revealOnHover && "blur-[5px]",
      )}
      title="Email hidden — use Show emails in the header or Settings"
    >
      {trimmed}
    </span>
  );
}

/** Redact emails in free-form log lines when blur is on. */
export function redactEmailsInText(text: string, blur: boolean): string {
  if (!blur) return text;
  return text.replace(EMAIL_RE, (email) => {
    const [user, domain] = email.split("@");
    const u = user.length <= 2 ? "••" : `${user.slice(0, 1)}•••`;
    return `${u}@${domain}`;
  });
}

export function PrivacyEmailToggle({ compact }: { compact?: boolean }) {
  const { blurEmails, toggleBlurEmails } = usePrivacyBlur();
  return (
    <Button
      type="button"
      variant="ghost"
      size={compact ? "sm" : "md"}
      onClick={toggleBlurEmails}
      className={clsx(
        "border-violet-500/20",
        blurEmails ? "text-violet-200/90" : "text-slate-300",
      )}
      title={blurEmails ? "Emails are blurred on screen" : "Emails are visible"}
    >
      {blurEmails ? "Show emails" : "Hide emails"}
    </Button>
  );
}
