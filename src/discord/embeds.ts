/** Shared Discord embed styling for automation reports. */

import { friendsDiscordBrandingEnabled } from "./friends-branding.js";

export type RushEmbed = {
  title: string;
  description?: string;
  color?: number;
  fields?: Array<{ name: string; value: string; inline?: boolean }>;
  footer?: { text: string };
  author?: { name: string };
  timestamp?: string;
};

export const BRAND = {
  name: "Rush Pilot",
  footer: "Self-hosted · RoRush automation",
} as const;

export const COLORS = {
  rainOk: 0x8b_5c_f6,
  rainFail: 0xf5_9e_0b,
  rainSummary: 0x06_b6_d4,
  limboHit: 0x10_b9_81,
  limboMiss: 0xef_44_44,
  limboSkip: 0x94_a3_b8,
  case: 0xfb_bf_24,
  activity: 0x63_66_f1,
  info: 0xa7_8b_fa,
} as const;

export function shortRainId(rainId: string | null | undefined): string {
  if (!rainId) return "—";
  const t = rainId.trim();
  if (t.length <= 12) return `\`${t}\``;
  return `\`${t.slice(0, 8)}…${t.slice(-4)}\``;
}

export function formatCoins(n: number): string {
  return `${n.toFixed(2)} coins`;
}

export function formatBalanceChange(before: number, after: number): string {
  const delta = after - before;
  const sign = delta >= 0 ? "+" : "";
  return `${before.toFixed(2)} → **${after.toFixed(2)}** (${sign}${delta.toFixed(2)})`;
}

export function categoryEmoji(category: string, message: string): string {
  if (category === "rain") {
    if (/joined rain/i.test(message)) return "🌧️";
    if (/summary/i.test(message)) return "📊";
    if (/fail|error/i.test(message)) return "⚠️";
    return "🌧️";
  }
  if (category === "limbo") {
    if (/hit/i.test(message)) return "🎯";
    if (/miss/i.test(message)) return "💥";
    if (/skipped/i.test(message)) return "⏭️";
    return "🎲";
  }
  if (category === "case") return "📦";
  if (category === "vault") return "🔒";
  return "▪️";
}

export function withBrand(embed: RushEmbed, accent: keyof typeof COLORS | number): RushEmbed {
  const color = typeof accent === "number" ? accent : COLORS[accent];
  const stamped: RushEmbed = { ...embed, color, timestamp: embed.timestamp ?? new Date().toISOString() };
  if (!friendsDiscordBrandingEnabled()) {
    return stamped;
  }
  return {
    ...stamped,
    author: embed.author ?? { name: BRAND.name },
    footer: embed.footer ?? { text: BRAND.footer },
  };
}

/** Parse `joined 2/2 · 45s captcha · window used · nick1, nick2` */
export function parseRainSummaryDetail(detail: string | null): Array<{ label: string; value: string }> {
  if (!detail?.trim()) return [];
  return detail.split(" · ").map((part) => {
    const idx = part.indexOf(" ");
    if (idx <= 0) return { label: "Info", value: part.trim() };
    return {
      label: part.slice(0, idx).replace(/^\w/, (c) => c.toUpperCase()),
      value: part.slice(idx + 1).trim(),
    };
  });
}
