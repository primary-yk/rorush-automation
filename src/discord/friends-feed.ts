import {
  ChannelType,
  EmbedBuilder,
  PermissionFlagsBits,
  type Client,
  type TextChannel,
} from "discord.js";
import {
  getAccount,
  getDiscordUserThread,
  getSettings,
  listAccounts,
  type SettingsRow,
} from "../db/repositories.js";
import { categoryEmoji, COLORS, withBrand, type RushEmbed } from "./embeds.js";
import { isFriendsHostMode } from "./host-alerts.js";
import { parseFriendsServerLayout, type FriendsServerLayout } from "./friends-layout.js";
import { redactForDiscord, type ActivityLogRow } from "./public-alert-filter.js";

let clientRef: Client | null = null;

export function bindFriendsFeedClient(client: Client | null): void {
  clientRef = client;
}

export function friendsServerFeedActive(settings: SettingsRow = getSettings()): boolean {
  if (!isFriendsHostMode()) return false;
  return !!(settings.discord_thread_parent_id?.trim() && settings.discord_host_log_channel_id?.trim());
}

/** Host DMs only when explicitly enabled or no server layout yet. */
export function hostDmAlertsEnabled(): boolean {
  const v = process.env.DISCORD_HOST_DM_ALERTS?.trim().toLowerCase();
  if (v === "1" || v === "true" || v === "yes" || v === "on") return true;
  if (v === "0" || v === "false" || v === "no" || v === "off") return false;
  return !friendsServerFeedActive();
}

function rushToDiscordEmbed(embed: RushEmbed): EmbedBuilder {
  const e = new EmbedBuilder().setTitle(embed.title.slice(0, 256));
  if (embed.description) e.setDescription(embed.description.slice(0, 4096));
  if (embed.color != null) e.setColor(embed.color);
  if (embed.fields?.length) {
    e.addFields(
      embed.fields.slice(0, 25).map((f) => ({
        name: f.name.slice(0, 256),
        value: f.value.slice(0, 1024),
        inline: f.inline,
      })),
    );
  }
  if (embed.footer?.text) e.setFooter({ text: embed.footer.text.slice(0, 2048) });
  if (embed.timestamp) {
    const ts = Date.parse(embed.timestamp);
    if (!Number.isNaN(ts)) e.setTimestamp(ts);
  }
  return e;
}

async function sendEmbedsToChannel(channelId: string, embeds: RushEmbed[]): Promise<void> {
  const client = clientRef;
  if (!client || embeds.length === 0) return;
  const ch = await client.channels.fetch(channelId).catch(() => null);
  if (!ch?.isTextBased()) return;
  const built = embeds.slice(0, 10).map(rushToDiscordEmbed);
  await (ch as TextChannel).send({ embeds: built }).catch(() => undefined);
}

export async function postToHostLogChannel(embeds: RushEmbed[]): Promise<void> {
  const hostLogId = getSettings().discord_host_log_channel_id?.trim();
  if (!hostLogId || embeds.length === 0) return;
  await sendEmbedsToChannel(hostLogId, embeds);
}

export async function postToUserFeedThread(discordUserId: string, embeds: RushEmbed[]): Promise<void> {
  if (!discordUserId || embeds.length === 0) return;
  const row = getDiscordUserThread(discordUserId);
  if (!row?.thread_id) return;
  await sendEmbedsToChannel(row.thread_id, embeds);
}

function ownerForAccountId(accountId: number | null | undefined): string | null {
  if (accountId == null) return null;
  return getAccount(accountId)?.owner_discord_id?.trim() ?? null;
}

function ownerForNickname(nickname: string | undefined): string | null {
  if (!nickname?.trim()) return null;
  const q = nickname.trim().toLowerCase();
  const row = listAccounts().find((a) => a.nickname.toLowerCase() === q);
  return row?.owner_discord_id?.trim() ?? null;
}

const HOST_TITLE =
  /failed|issue|error|captcha|offline|pipeline|timeout|stall|not ready|summary|batch|window open/i;

/** @internal testable routing without DB/settings. */
export function classifyEmbedRoute(title: string, hasOwner: boolean): "host" | "user" {
  if (HOST_TITLE.test(title)) return "host";
  if (/joined|hit|miss|limbo|rain|case/i.test(title) && hasOwner) return "user";
  if (hasOwner) return "user";
  return "host";
}

export function routeReporterEmbed(
  embed: RushEmbed,
  ctx?: { accountId?: number | null; nickname?: string | null },
): "host" | "user" | "both" | "skip" {
  if (!friendsServerFeedActive()) return "skip";
  const title = embed.title ?? "";
  const owner =
    ownerForAccountId(ctx?.accountId) ?? ownerForNickname(ctx?.nickname ?? undefined);
  return classifyEmbedRoute(title, !!owner);
}

export async function deliverFriendsReporterEmbed(
  embed: RushEmbed,
  ctx?: { accountId?: number | null; nickname?: string | null },
): Promise<boolean> {
  if (!friendsServerFeedActive()) return false;
  const route = routeReporterEmbed(embed, ctx);
  if (route === "skip") return false;
  if (route === "host" || route === "both") await postToHostLogChannel([embed]);
  if (route === "user" || route === "both") {
    const owner =
      ownerForAccountId(ctx?.accountId) ?? ownerForNickname(ctx?.nickname ?? undefined);
    if (owner) await postToUserFeedThread(owner, [embed]);
  }
  return true;
}

export function layoutFromSettings(settings: SettingsRow = getSettings()): FriendsServerLayout | null {
  return parseFriendsServerLayout(settings.discord_server_layout_json);
}

export async function postFriendsActivityLogs(logs: ActivityLogRow[]): Promise<void> {
  if (!friendsServerFeedActive() || logs.length === 0) return;
  const hostBatch: RushEmbed[] = [];
  const byUser = new Map<string, RushEmbed[]>();

  for (const log of logs) {
    const embed = activityLogToEmbed(log);
    const owner = ownerForAccountId(log.account_id);
    const hostish =
      /join failed|join error|pipeline error|captcha|timeout|fail|error/i.test(log.message) ||
      log.category === "system";
    if (hostish || !owner) {
      hostBatch.push(embed);
    } else {
      const list = byUser.get(owner) ?? [];
      list.push(embed);
      byUser.set(owner, list);
    }
  }

  if (hostBatch.length) await postToHostLogChannel(hostBatch);
  for (const [userId, embeds] of byUser) {
    await postToUserFeedThread(userId, embeds);
  }
}

function activityLogToEmbed(log: ActivityLogRow): RushEmbed {
  const nick =
    log.account_id != null
      ? (listAccounts().find((a) => a.id === log.account_id)?.nickname ?? "Account")
      : "Engine";
  const t = log.created_at.slice(11, 19);
  const emoji = categoryEmoji(log.category, log.message);
  const message = redactForDiscord(log.message);
  let detail = log.detail?.trim();
  if (detail) {
    detail = redactForDiscord(detail);
    if (/^\S+@\S+\.\S+$/.test(detail)) detail = undefined;
  }
  const value = detail ? `**${message}**\n${detail.slice(0, 350)}` : `**${message}**`;
  const color =
    log.category === "rain"
      ? COLORS.rainOk
      : log.category === "limbo"
        ? COLORS.limboSkip
        : COLORS.activity;
  return withBrand(
    {
      title: `${emoji} ${nick} · ${t}`,
      description: value.slice(0, 4096),
      color,
      footer: { text: "Rain feed" },
    },
    color,
  );
}

export const SETUP_SERVER_BOT_PERMISSIONS: bigint =
  PermissionFlagsBits.ManageRoles |
  PermissionFlagsBits.ManageChannels |
  PermissionFlagsBits.ManageThreads |
  PermissionFlagsBits.SendMessages |
  PermissionFlagsBits.EmbedLinks |
  PermissionFlagsBits.ViewChannel;
