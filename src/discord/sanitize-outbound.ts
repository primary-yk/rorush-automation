import { discordSupportMention } from "./friends-copy.js";

/**
 * Keep Discord replies free of site URLs, dashboard links, install instructions, and product/host PC wording.
 */
export function sanitizeDiscordOutbound(text: string): string {
  const support = discordSupportMention();
  // Host diagnostics (paths, encryption) — do not rewrite npm/doctor hints into ping text.
  if (/ENCRYPTION_KEY|Project folder:|This bot process:|\/workspace|\/home\//i.test(text)) {
    return text
      .replace(/https?:\/\/[^\s<>)]+/gi, "")
      .replace(/\s{2,}/g, " ")
      .trim();
  }
  return text
    .replace(/https?:\/\/[^\s<>)]+/gi, "")
    .replace(/\b127\.0\.0\.1:\d+/g, "")
    .replace(/\blocalhost:\d+/gi, "")
    .replace(/:43123\b/g, "")
    .replace(/:43124\b/g, "")
    .replace(/npm run [a-z0-9:-]+/gi, `ping ${support}`)
    .replace(/rush\s*pilot/gi, "")
    .replace(/rorush automation/gi, "")
    .replace(/the host runs[^.\n]*/gi, "")
    .replace(/host runs[^.\n]*on (their|your) (pc|machine)[^.]*/gi, "")
    .replace(/runs on (their|your|the) (pc|machine)/gi, "")
    .replace(/ask the host/gi, `ping ${support}`)
    .replace(/questions\?\s*ask the host[^.]*/gi, "")
    .replace(/\s{2,}/g, " ")
    .trim();
}
