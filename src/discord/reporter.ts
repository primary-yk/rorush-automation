import { fetch } from "undici";
import { getSettings, listAccounts } from "../db/repositories.js";
import { isRelayConnected, sendPilotEvent } from "../relay/pilot-client.js";
import { redactForDiscord } from "./public-alert-filter.js";
import { resolveDiscordReportWebhookUrl } from "./report-webhook.js";

type Embed = {
  title: string;
  description?: string;
  color?: number;
  fields?: Array<{ name: string; value: string; inline?: boolean }>;
  footer?: { text: string };
};

const COLOR_HIT = 0x34_d3_99;
const COLOR_MISS = 0xf4_3f_5e;
const COLOR_INFO = 0x8b_5c_f6;
const COLOR_WARN = 0xf5_9e_0b;

function webhookConfigured(): string | null {
  return resolveDiscordReportWebhookUrl();
}

async function deliverEmbed(embed: Embed): Promise<void> {
  if (isRelayConnected()) {
    const t = embed.title.toLowerCase();
    const kind = t.includes("limbo") ? "limbo" : t.includes("account") ? "accounts" : t.includes("rain") ? "rain" : "system";
    sendPilotEvent({ type: "event", kind, embed });
    return;
  }
  const url = webhookConfigured();
  if (!url) return;
  try {
    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        embeds: [{ ...embed, timestamp: new Date().toISOString() }],
      }),
    });
    if (!res.ok) {
      console.warn("[discord report]", res.status, await res.text().catch(() => ""));
    }
  } catch (err) {
    console.warn("[discord report]", err instanceof Error ? err.message : String(err));
  }
}

export async function reportLimboOutcome(input: {
  nickname: string;
  hit: boolean;
  betCoins: number;
  targetMultiplier: number;
  crashMultiplier?: number | null;
  rainId?: string | null;
  balanceBefore?: number | null;
  balanceAfter?: number | null;
}): Promise<void> {
  const crash =
    input.crashMultiplier != null ? `${input.crashMultiplier.toFixed(2)}×` : "—";
  const title = input.hit
    ? `Limbo hit at ${crash}`
    : `Limbo miss — crashed at ${crash}`;
  const color = input.hit ? COLOR_HIT : COLOR_MISS;
  const fields: Embed["fields"] = [
    { name: "Account", value: input.nickname, inline: true },
    { name: "Bet", value: `${input.betCoins.toFixed(2)} coins`, inline: true },
    { name: "Target", value: `${input.targetMultiplier.toFixed(2)}×`, inline: true },
    { name: "Result", value: crash, inline: true },
  ];
  if (input.balanceBefore != null) {
    fields.push({ name: "Balance before", value: `${input.balanceBefore.toFixed(2)} coins`, inline: true });
  }
  if (input.balanceAfter != null) {
    fields.push({ name: "Balance after", value: `${input.balanceAfter.toFixed(2)} coins`, inline: true });
  }
  if (input.rainId) {
    fields.push({ name: "Rain", value: input.rainId, inline: false });
  }
  await deliverEmbed({
    title,
    color,
    fields,
    footer: { text: "Rush Pilot · limbo wager" },
  });
}

export async function reportRainOutcome(input: {
  nickname: string;
  success: boolean;
  message: string;
  rainId: string;
  poolCoins?: number;
}): Promise<void> {
  await deliverEmbed({
    title: input.success ? "Rain joined" : "Rain failed",
    color: input.success ? COLOR_HIT : COLOR_WARN,
    fields: [
      { name: "Account", value: input.nickname, inline: true },
      { name: "Pool", value: input.poolCoins != null ? `${input.poolCoins.toFixed(2)} coins` : "—", inline: true },
      { name: "Detail", value: redactForDiscord(input.message).slice(0, 900), inline: false },
      { name: "Rain ID", value: input.rainId, inline: false },
    ],
    footer: { text: "Rush Pilot · rain" },
  });
}

export async function reportAccountSnapshot(reason: string): Promise<void> {
  const accounts = listAccounts();
  const lines =
    accounts.length === 0
      ? "_No accounts configured_"
      : accounts
          .map((a) => {
            const flags = [
              a.join_rain ? "rain" : null,
              a.auto_open_cases ? "cases" : null,
              a.auto_redeem_codes ? "codes" : null,
              a.limbo_wager_enabled ? "limbo" : null,
            ]
              .filter(Boolean)
              .join(", ");
            return `**${a.nickname}** · ${flags || "no toggles"} · ${a.status}`;
          })
          .join("\n");

  await deliverEmbed({
    title: "Accounts attached",
    description: lines.slice(0, 3800),
    color: COLOR_INFO,
    footer: { text: `Rush Pilot · ${reason}` },
  });
}

export async function sendTestReport(): Promise<{ ok: boolean; error?: string }> {
  if (!isRelayConnected() && !webhookConfigured()) {
    return {
      ok: false,
      error: "Connect DISCORD_BOT_RELAY_URL and /activate in the bot, or set a report webhook.",
    };
  }
  await deliverEmbed({
    title: "Test message",
    description: "Rush Pilot can reach your private thread. Limbo and rain events will appear here.",
    color: COLOR_INFO,
  });
  return { ok: true };
}
