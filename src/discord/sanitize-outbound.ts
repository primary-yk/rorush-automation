/**
 * Keep Discord replies free of site URLs, dashboard links, and install instructions.
 * Tracked in docs/PRIORITIES-STATUS.md (2026-10-20 agent promise — DONE).
 */
export function sanitizeDiscordOutbound(text: string): string {
  return text
    .replace(/https?:\/\/[^\s<>)]+/gi, "")
    .replace(/\b127\.0\.0\.1:\d+/g, "")
    .replace(/\blocalhost:\d+/gi, "")
    .replace(/:43123\b/g, "")
    .replace(/:43124\b/g, "")
    .replace(/npm run dev/gi, "ask the host")
    .replace(/\s{2,}/g, " ")
    .trim();
}
