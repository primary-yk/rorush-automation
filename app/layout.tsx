import type { Metadata } from "next";
import { DM_Sans, JetBrains_Mono } from "next/font/google";
import "./globals.css";

const display = DM_Sans({
  subsets: ["latin"],
  variable: "--font-display",
});

const mono = JetBrains_Mono({
  subsets: ["latin"],
  variable: "--font-mono",
});

export const metadata: Metadata = {
  title: "Rush Pilot — RoRush Automation",
  description: "Self-hosted rain, cases, and promo automation for RoRush",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`${display.variable} ${mono.variable}`}>
      <body className="font-display">{children}</body>
    </html>
  );
}
