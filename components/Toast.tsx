"use client";

import clsx from "clsx";
import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from "react";

type ToastKind = "success" | "error" | "info";

type ToastState = { message: string; kind: ToastKind } | null;

type ToastContextValue = {
  push: (message: string, kind?: ToastKind) => void;
};

const ToastContext = createContext<ToastContextValue | null>(null);

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toast, setToast] = useState<ToastState>(null);

  const push = useCallback((message: string, kind: ToastKind = "info") => {
    setToast({ message, kind });
    window.setTimeout(() => setToast(null), 4500);
  }, []);

  const value = useMemo(() => ({ push }), [push]);

  return (
    <ToastContext.Provider value={value}>
      {children}
      {toast && (
        <div
          className="pointer-events-none fixed bottom-6 left-1/2 z-50 max-w-md -translate-x-1/2 px-4"
          role="status"
        >
          <div
            className={clsx(
              "rounded-2xl border px-4 py-3 text-sm shadow-2xl backdrop-blur-md",
              toast.kind === "success" && "border-emerald-400/30 bg-emerald-950/90 text-emerald-100",
              toast.kind === "error" && "border-rose-400/30 bg-rose-950/90 text-rose-100",
              toast.kind === "info" && "border-violet-400/30 bg-[#0c0d14]/95 text-slate-100",
            )}
          >
            {toast.message}
          </div>
        </div>
      )}
    </ToastContext.Provider>
  );
}

export function useToast(): ToastContextValue {
  const ctx = useContext(ToastContext);
  if (!ctx) throw new Error("useToast must be used within ToastProvider");
  return ctx;
}
