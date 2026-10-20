"use client";

import type { ReactNode } from "react";
import { PrivacyBlurProvider } from "./PrivacyBlur";
import { ToastProvider } from "./Toast";

export function Providers({ children }: { children: ReactNode }) {
  return (
    <PrivacyBlurProvider>
      <ToastProvider>{children}</ToastProvider>
    </PrivacyBlurProvider>
  );
}
