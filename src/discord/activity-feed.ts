import { fetch } from "undici";
import { decryptField } from "../accounts/session-manager.js";
import { loadConfig } from "../config.js";
import { getSettings, listAccounts } from "../db/repositories.js";
import { isRelayConnected, sendPilotEvent } from "../relay/pilot-client.js";
import { resolveDiscordReportWebhookUrl } from "./report-webhook.js";

export type ActivityLogRow = {
  account_id: number | null;
  category: string;
  message: string;
  detail: string | null;
  created_at: string;
};

const CATEGORY_COLOR: Record<string, number> = {
  rain: 0x38_bdf_8,
  limbo: 0xd9_46_ef,
  case: 0xfb_bf_24,
  discord: 0x63_66_f1,
  system: 0x94_a3_b8,
};

const queue: ActivityLogRow[] = [];
let flushTimer: NodeJS.Timeout | null = null;

function webhookUrl(): string | null {
  return resolveDiscordReportWebhookUrl();
}

function activityFeedEnabled(): boolean {
  const s = getSettings();
  return !!s.discord_report_enabled && !!s.discord_activity_feed_enabled;
}

function envBotChannel(): { token: string; channelId: string } | null {
  const token = process.env.DISCORD_BOT_TOKEN?.trim();
  const channelId = process.env.DISCORD_ACTIVITY_CHANNEL_ID?.trim();
  if (!token || !channelId) return null;
  return { token, channelId };
}

function shouldForward(log: ActivityLogRow): boolean {
  if (isRelayConnected()) return true;
  if (envBotChannel()) return true;
  if (!webhookUrl()) return false;
  if (activityFeedEnabled()) return true;
  const text = `${log.message} ${log.detail ?? ""}`.toLowerCase();
  if (log.category === "rain" || log.category === "limbo" || log.category === "case") return true;
  if (/error|fail|joined|captcha|wager|timeout|paused|started/.test(text)) return true;
  return false;
}

function accountNickname(accountId: number | null): string | null {
  if (accountId == null) return null;
  return listAccounts().find((a) => a.id === accountId)?.nickname ?? null;
}

function formatLine(log: ActivityLogRow): string {
  const t = log.created_at.slice(11, 19);
  const nick = accountNickname(log.account_id);
  const who = nick ? ` **${nick}**` : "";
  const detail = log.detail?.trim();
  const extra = detail ? `\n> ${detail.split("\n").join("\n> ").slice(0, 500)}` : "";
  return `\`${t}\` **${log.category}**${who} · ${log.message}${extra}`;
}

async function postWebhook(content: string, embed?: { title: string; description: string; color: number }): Promise<void> {
  const url = webhookUrl();
  if (!url) return;
  try {
    await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(
        embed
          ? { embeds: [{ ...embed, timestamp: new Date().toISOString() }] }
          : { content: content.slice(0, 2000) },
      ),
    });
  } catch (err) {
    console.warn("[discord activity]", err instanceof Error ? err.message : String(err));
  }
}

async function postBotChannel(content: string): Promise<void> {
  const bot = envBotChannel();
  if (!bot) return;
  try {
    const res = await fetch(`https://discord.com/api/v10/channels/${bot.channelId}/messages`, {
      method: "POST",
      headers: {
        Authorization: `Bot ${bot.token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ content: content.slice(0, 2000) }),
    });
    if (!res.ok) {
      console.warn("[discord bot channel]", res.status, await res.text().catch(() => ""));
    }
  } catch (err) {
    console.warn("[discord bot channel]", err instanceof Error ? err.message : String(err));
  }
}

async function flushQueue(): Promise<void> {
  flushTimer = null;
  if (queue.length === 0) return;
  const batch = queue.splice(0, 8);
  const lines = batch.map(formatLine).join("\n");
  const primary = batch[batch.length - 1]!;
  const color = CATEGORY_COLOR[primary.category] ?? 0x8b_5c_f6;

  const embed = {
    title: isRelayConnected() ? "Pilot activity" : "Rush Pilot",
    description: lines.slice(0, 3900),
    color,
  };

  if (isRelayConnected()) {
    sendPilotEvent({ type: "event", kind: "activity", embed });
    return;
  }

  await postWebhook("", embed);
  await postBotChannel(lines.slice(0, 2000));
}

/** Called after each DB activity log insert (non-blocking). */
export function onActivityLog(log: ActivityLogRow): void {
  void loadConfig;
  if (!shouldForward(log)) return;
  queue.push(log);
  if (flushTimer) return;
  flushTimer = setTimeout(() => {
    void flushQueue();
  }, 1_200);
}
