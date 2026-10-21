import { fetch } from "undici";
import { reloadEnv } from "../config.js";
import type { RushEmbed } from "./embeds.js";

/** Friends mode: you host on your PC; customers use relay/SaaS instead. */
export function isFriendsHostMode(): boolean {
  reloadEnv();
  const saas = process.env.HOSTED_SAAS?.trim().toLowerCase();
  if (saas === "1" || saas === "true" || saas === "yes" || saas === "on") return false;
  if (process.env.DISCORD_BOT_RELAY_URL?.trim()) return false;
  return true;
}

export function hostDiscordUserId(): string | null {
  return process.env.HOST_DISCORD_USER_ID?.trim() || null;
}

function botToken(): string | null {
  return process.env.DISCORD_BOT_TOKEN?.trim() || null;
}

/** When true, activity also posts to DISCORD_ACTIVITY_CHANNEL_ID (visible to anyone in that channel). */
export function publicActivityChannelAllowed(): boolean {
  const v = process.env.DISCORD_ACTIVITY_PUBLIC?.trim().toLowerCase();
  return v === "1" || v === "true" || v === "yes" || v === "on";
}

async function openHostDmChannel(): Promise<string | null> {
  const token = botToken();
  const hostId = hostDiscordUserId();
  if (!token || !hostId) return null;
  try {
    const res = await fetch("https://discord.com/api/v10/users/@me/channels", {
      method: "POST",
      headers: {
        Authorization: `Bot ${token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ recipient_id: hostId }),
    });
    if (!res.ok) return null;
    const json = (await res.json()) as { id?: string };
    return json.id ?? null;
  } catch {
    return null;
  }
}

let cachedHostDmChannelId: string | null | undefined;

async function hostDmChannelId(): Promise<string | null> {
  if (cachedHostDmChannelId !== undefined) return cachedHostDmChannelId;
  cachedHostDmChannelId = await openHostDmChannel();
  return cachedHostDmChannelId;
}

export async function dmHostText(content: string): Promise<void> {
  const { hostDmAlertsEnabled } = await import("./friends-feed.js");
  if (!hostDmAlertsEnabled()) return;
  const token = botToken();
  const channelId = await hostDmChannelId();
  if (!token || !channelId || !content.trim()) return;
  try {
    await fetch(`https://discord.com/api/v10/channels/${channelId}/messages`, {
      method: "POST",
      headers: {
        Authorization: `Bot ${token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ content: content.slice(0, 2000) }),
    });
  } catch {
    /* best-effort */
  }
}

export async function dmHostEmbeds(embeds: RushEmbed[]): Promise<void> {
  const { hostDmAlertsEnabled } = await import("./friends-feed.js");
  if (!hostDmAlertsEnabled()) return;
  const token = botToken();
  const channelId = await hostDmChannelId();
  if (!token || !channelId || embeds.length === 0) return;
  try {
    await fetch(`https://discord.com/api/v10/channels/${channelId}/messages`, {
      method: "POST",
      headers: {
        Authorization: `Bot ${token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ embeds: embeds.slice(0, 10) }),
    });
  } catch {
    /* best-effort */
  }
}

export async function notifyHostSlashError(input: {
  command: string;
  userId: string;
  username: string;
  detail: string;
}): Promise<void> {
  const { notifyStaffSlashError } = await import("./friends-feed.js");
  await notifyStaffSlashError(input);
}
