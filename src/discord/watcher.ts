import { fetch } from "undici";
import { decryptField } from "../accounts/session-manager.js";
import { solveCaptcha } from "../captcha/capmonster.js";
import {
  appendLog,
  getSettings,
  listAccounts,
  markDiscordCodeSeen,
  recordCodeRedeem,
  updateAccount,
} from "../db/repositories.js";
import { ensureAuthenticated } from "../accounts/session-manager.js";

const CODE_RE = /\b([A-Z0-9]{4,16}(?:-[A-Z0-9]{2,8}){0,3})\b/g;

export type ParsedCode = {
  code: string;
  minLevel?: number;
};

export function extractCodesFromText(text: string): ParsedCode[] {
  const found: ParsedCode[] = [];
  const levelMatch = text.match(/level\s*(\d{1,3})/i);
  const minLevel = levelMatch ? Number(levelMatch[1]) : undefined;
  for (const match of text.matchAll(CODE_RE)) {
    const code = match[1];
    if (code.length < 4) continue;
    found.push({ code, minLevel });
  }
  return found;
}

export async function pollDiscordChannel(): Promise<void> {
  const settings = getSettings();
  if (!settings.discord_enabled || !settings.discord_channel_id || !settings.discord_token_enc) {
    return;
  }

  const token = decryptField(settings.discord_token_enc);
  if (!token) return;

  const res = await fetch(
    `https://discord.com/api/v10/channels/${settings.discord_channel_id}/messages?limit=25`,
    {
      headers: { Authorization: token },
    },
  );
  if (!res.ok) {
    appendLog({
      category: "discord",
      message: "Discord channel fetch failed",
      detail: `HTTP ${res.status}`,
    });
    return;
  }

  const messages = (await res.json()) as Array<{ id: string; content: string; embeds?: Array<{ description?: string; title?: string }> }>;
  for (const msg of messages.reverse()) {
    const parts = [msg.content];
    for (const embed of msg.embeds ?? []) {
      if (embed.title) parts.push(embed.title);
      if (embed.description) parts.push(embed.description);
    }
    const text = parts.join("\n");
    for (const parsed of extractCodesFromText(text)) {
      if (!markDiscordCodeSeen(parsed.code)) continue;
      await redeemOnAccounts(parsed);
    }
  }
}

async function redeemOnAccounts(parsed: ParsedCode): Promise<void> {
  const accounts = listAccounts().filter((a) => a.auto_redeem_codes);
  for (const account of accounts) {
    if ((account.level ?? 0) < (parsed.minLevel ?? account.min_code_level)) {
      appendLog({
        accountId: account.id,
        category: "codes",
        message: "Skipped code (level requirement)",
        detail: parsed.code,
      });
      continue;
    }

    try {
      const { client } = await ensureAuthenticated(account.id);
      let turnstile: string | null = null;
      try {
        turnstile = await solveCaptcha("turnstile");
      } catch {
        turnstile = null;
      }
      await client.redeemFlashcode(parsed.code, turnstile);
      recordCodeRedeem({
        accountId: account.id,
        code: parsed.code,
        success: true,
        siteMessage: "OK",
        rewardAmount: null,
      });
      updateAccount(account.id, { status: "idle", last_error: null });
      appendLog({
        accountId: account.id,
        category: "codes",
        message: "Redeemed code",
        detail: parsed.code,
      });
    } catch (err) {
      const siteMessage = err instanceof Error ? err.message : String(err);
      recordCodeRedeem({
        accountId: account.id,
        code: parsed.code,
        success: false,
        siteMessage,
        rewardAmount: null,
      });
      updateAccount(account.id, { status: "error", last_error: siteMessage });
      appendLog({
        accountId: account.id,
        category: "codes",
        message: "Code redeem failed",
        detail: siteMessage,
      });
    }
  }
}
