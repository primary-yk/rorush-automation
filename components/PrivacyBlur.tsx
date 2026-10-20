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
const EMAIL_SINGLE = /^[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}$/;

export function maskEmail(email: string): string {
  const trimmed = email.trim();
  const at = trimmed.indexOf("@");
  if (at <= 0) return "•••••";
  const user = trimmed.slice(0, at);
  const domain = trimmed.slice(at + 1);
  const dot = domain.lastIndexOf(".");
  const tld = dot >= 0 ? domain.slice(dot) : "";
  const host = dot >= 0 ? domain.slice(0, dot) : domain;
  const u = user.length <= 1 ? "•" : `${user[0]}•••`;
  const h = host.length <= 1 ? "•••" : `${host[0]}••••`;
  return `${u}@${h}${tld}`;
}

export function isEmailLike(text: string): boolean {
  return EMAIL_SINGLE.test(text.trim());
}

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
}: {
  text: string;
  className?: string;
}) {
  const { blurEmails } = usePrivacyBlur();
  const [revealed, setRevealed] = useState(false);
  const trimmed = text.trim();
  const looksEmail = isEmailLike(trimmed);

  if (!looksEmail) {
    return <span className={className}>{text}</span>;
  }

  if (!blurEmails || revealed) {
    return (
      <span className={className}>
        {text}
        {blurEmails && (
          <button
            type="button"
            className="ml-2 text-[11px] font-normal text-violet-400/80 underline-offset-2 hover:underline"
            onClick={() => setRevealed(false)}
          >
            Hide
          </button>
        )}
      </span>
    );
  }

  return (
    <button
      type="button"
      onClick={() => setRevealed(true)}
      className={clsx(
        className,
        "inline-block cursor-pointer rounded-md bg-black/50 px-1.5 py-0.5 font-mono text-sm tracking-wide text-violet-200/80 ring-1 ring-violet-500/25 transition hover:ring-violet-400/40",
      )}
      title="Login email hidden — click to reveal, or use Show emails in the header"
    >
      {maskEmail(trimmed)}
    </button>
  );
}

/** Redact emails in free-form log lines when blur is on. */
export function redactEmailsInText(text: string, blur: boolean): string {
  if (!blur) return text;
  return text.replace(new RegExp(EMAIL_RE.source, "g"), (email) => maskEmail(email));
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
