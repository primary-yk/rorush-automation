import { fetch } from "undici";
import { loadConfig } from "../config.js";
import { getSettings, listAccounts } from "../db/repositories.js";
import { isRelayConnected, sendPilotEvent } from "../relay/pilot-client.js";
import {
  COLORS,
  categoryEmoji,
  withBrand,
  type RushEmbed,
} from "./embeds.js";
import {
  formatPublicDiscordLine,
  redactForDiscord,
  shouldPostPublicDiscordAlert,
} from "./public-alert-filter.js";
import { reportLimboSkipped, reportRainAlert, reportRainJoinSummary } from "./reporter.js";
import {
  dmHostEmbeds,
  isFriendsHostMode,
  publicActivityChannelAllowed,
} from "./host-alerts.js";
import { resolveDiscordReportWebhookUrl } from "./report-webhook.js";

export type { ActivityLogRow } from "./public-alert-filter.js";
import type { ActivityLogRow } from "./public-alert-filter.js";

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

function reportingEnabled(): boolean {
  const s = getSettings();
  return !!s.discord_report_enabled;
}

function shouldForward(log: ActivityLogRow): boolean {
  if (!reportingEnabled()) return false;
  const full = activityFeedEnabled();
  if (isRelayConnected()) return shouldPostPublicDiscordAlert(log, full);
  if (envBotChannel()) return shouldPostPublicDiscordAlert(log, full);
  if (!webhookUrl()) return false;
  return shouldPostPublicDiscordAlert(log, full);
}

function accountNickname(accountId: number | null): string | null {
  if (accountId == null) return null;
  return listAccounts().find((a) => a.id === accountId)?.nickname ?? null;
}

function logToField(log: ActivityLogRow): { name: string; value: string; inline?: boolean } {
  const nick = accountNickname(log.account_id) ?? "Engine";
  const t = log.created_at.slice(11, 19);
  const emoji = categoryEmoji(log.category, log.message);
  const message = redactForDiscord(log.message);
  let detail = log.detail?.trim();
  if (detail) {
    detail = redactForDiscord(detail);
    if (/^\S+@\S+\.\S+$/.test(detail)) detail = undefined;
  }
  const value = detail ? `**${message}**\n${detail.slice(0, 350)}` : `**${message}**`;
  return {
    name: `${emoji} ${nick} · ${t}`,
    value: value.slice(0, 1024),
    inline: false,
  };
}

function buildDigestEmbed(logs: ActivityLogRow[]): RushEmbed {
  const primary = logs[logs.length - 1]!;
  const category = primary.category;
  const title =
    category === "case"
      ? "Cases"
      : category === "rain"
        ? "Rain alerts"
        : category === "limbo"
          ? "Limbo notes"
          : "Activity";

  return withBrand(
    {
      title,
      description: logs.length === 1 ? undefined : `${logs.length} events batched`,
      color:
        category === "rain"
          ? COLORS.rainOk
          : category === "limbo"
            ? COLORS.limboSkip
            : category === "case"
              ? COLORS.case
              : COLORS.activity,
      fields: logs.map(logToField).slice(0, 8),
      footer: { text: activityFeedEnabled() ? "Full activity feed" : "Filtered feed" },
    },
    category === "rain" ? COLORS.rainOk : COLORS.activity,
  );
}

async function postEmbeds(embeds: RushEmbed[]): Promise<void> {
  if (embeds.length === 0) return;
  const stamped = embeds.map((e) => withBrand(e, e.color ?? COLORS.activity));
  if (isRelayConnected()) {
    for (const embed of stamped) {
      sendPilotEvent({ type: "event", kind: "activity", embed });
    }
    return;
  }
  const url = webhookUrl();
  if (url) {
    try {
      await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ embeds: stamped.slice(0, 10) }),
      });
    } catch (err) {
      console.warn("[discord activity]", err instanceof Error ? err.message : String(err));
    }
  }
  const bot = envBotChannel();
  if (bot) {
    if (isFriendsHostMode() && !publicActivityChannelAllowed()) {
      await dmHostEmbeds(stamped);
      return;
    }
    const lines = stamped
      .flatMap((e) => e.fields?.map((f) => `${f.name}\n${f.value}`) ?? [e.description ?? e.title])
      .join("\n\n")
      .slice(0, 2000);
    try {
      await fetch(`https://discord.com/api/v10/channels/${bot.channelId}/messages`, {
        method: "POST",
        headers: {
          Authorization: `Bot ${bot.token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ content: lines }),
      });
    } catch (err) {
      console.warn("[discord bot channel]", err instanceof Error ? err.message : String(err));
    }
  } else if (isFriendsHostMode() && !webhookUrl()) {
    await dmHostEmbeds(stamped);
  }
}

async function flushQueue(): Promise<void> {
  flushTimer = null;
  if (queue.length === 0) return;

  const batch = queue.splice(0, 12);
  const byCategory = new Map<string, ActivityLogRow[]>();
  for (const log of batch) {
    const key = log.category;
    const list = byCategory.get(key) ?? [];
    list.push(log);
    byCategory.set(key, list);
  }

  const embeds: RushEmbed[] = [];
  for (const [, logs] of byCategory) {
    for (let i = 0; i < logs.length; i += 6) {
      embeds.push(buildDigestEmbed(logs.slice(i, i + 6)));
    }
  }
  await postEmbeds(embeds);
}

/** Called after each DB activity log insert (non-blocking). */
export function onActivityLog(log: ActivityLogRow): void {
  void loadConfig;
  if (!shouldForward(log)) return;

  if (log.message === "Rain join summary") {
    void reportRainJoinSummary(log.detail);
    return;
  }

  if (log.message === "Limbo skipped after rain") {
    void reportLimboSkipped({
      nickname: accountNickname(log.account_id) ?? "Pilot",
      reason: log.detail ?? log.message,
      rainId: log.detail?.match(/[0-9a-f-]{36}/i)?.[0],
    });
    return;
  }

  if (log.category === "rain" && /join failed|join error|pipeline error/i.test(log.message)) {
    void reportRainAlert({
      nickname: accountNickname(log.account_id),
      title: "Rain — Issue",
      body: log.detail ? `${log.message}\n${log.detail}` : log.message,
      rainId: log.detail?.match(/[0-9a-f-]{36}/i)?.[0],
    });
    return;
  }

  queue.push(log);
  if (flushTimer) return;
  flushTimer = setTimeout(() => {
    void flushQueue();
  }, 1_400);
}

/** @internal tests */
export function formatLineForTests(log: ActivityLogRow): string {
  const nick = accountNickname(log.account_id);
  return formatPublicDiscordLine(log, nick, activityFeedEnabled());
}
