import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "RoRush Automation",
  description: "Self-hosted RoRush rain, cases, and promo automation",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
