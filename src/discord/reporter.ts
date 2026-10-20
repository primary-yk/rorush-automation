import { fetch } from "undici";
import { listAccounts } from "../db/repositories.js";
import { isRelayConnected, sendPilotEvent } from "../relay/pilot-client.js";
import { redactForDiscord } from "./public-alert-filter.js";
import { resolveDiscordReportWebhookUrl } from "./report-webhook.js";
import {
  COLORS,
  formatBalanceChange,
  formatCoins,
  parseRainSummaryDetail,
  shortRainId,
  withBrand,
  type RushEmbed,
} from "./embeds.js";

function webhookConfigured(): string | null {
  return resolveDiscordReportWebhookUrl();
}

async function deliverEmbed(embed: RushEmbed): Promise<void> {
  const payload = withBrand(embed, embed.color ?? COLORS.info);
  if (isRelayConnected()) {
    const t = payload.title.toLowerCase();
    const kind = t.includes("limbo")
      ? "limbo"
      : t.includes("account")
        ? "accounts"
        : t.includes("rain") || t.includes("batch")
          ? "rain"
          : "system";
    sendPilotEvent({ type: "event", kind, embed: payload });
    return;
  }
  const url = webhookConfigured();
  if (!url) return;
  try {
    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ embeds: [payload] }),
    });
    if (!res.ok) {
      console.warn("[discord report]", res.status, await res.text().catch(() => ""));
    }
  } catch (err) {
    console.warn("[discord report]", err instanceof Error ? err.message : String(err));
  }
}

export async function deliverEmbeds(embeds: RushEmbed[]): Promise<void> {
  if (embeds.length === 0) return;
  const stamped = embeds.slice(0, 10).map((e) => withBrand(e, e.color ?? COLORS.info));
  if (isRelayConnected()) {
    for (const embed of stamped) {
      sendPilotEvent({ type: "event", kind: "activity", embed });
    }
    return;
  }
  const url = webhookConfigured();
  if (!url) return;
  try {
    await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ embeds: stamped }),
    });
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
  reasonLabel?: string | null;
}): Promise<void> {
  const crash =
    input.crashMultiplier != null ? `${input.crashMultiplier.toFixed(2)}×` : "—";
  const title = input.hit ? "Limbo — Hit" : "Limbo — Miss";
  const headline = input.hit
    ? `Crashed **${crash}** (needed **${input.targetMultiplier.toFixed(2)}×**).`
    : `Crashed **${crash}** before **${input.targetMultiplier.toFixed(2)}×**.`;

  const fields: RushEmbed["fields"] = [
    { name: "Pilot", value: `**${input.nickname}**`, inline: true },
    { name: "Wager", value: formatCoins(input.betCoins), inline: true },
    { name: "Target ×", value: `${input.targetMultiplier.toFixed(2)}×`, inline: true },
    { name: "Outcome ×", value: crash, inline: true },
  ];

  if (input.balanceBefore != null && input.balanceAfter != null) {
    fields.push({
      name: "Balance",
      value: formatBalanceChange(input.balanceBefore, input.balanceAfter),
      inline: false,
    });
  } else if (input.balanceBefore != null) {
    fields.push({ name: "Balance before", value: formatCoins(input.balanceBefore), inline: true });
  }

  if (input.reasonLabel) {
    fields.push({ name: "Context", value: redactForDiscord(input.reasonLabel), inline: false });
  }
  if (input.rainId && input.rainId !== "test-limbo") {
    fields.push({ name: "Rain", value: shortRainId(input.rainId), inline: false });
  }

  await deliverEmbed({
    title,
    description: headline,
    color: input.hit ? COLORS.limboHit : COLORS.limboMiss,
    fields,
    footer: { text: "Limbo wager" },
  });
}

export async function reportRainOutcome(input: {
  nickname: string;
  success: boolean;
  message: string;
  rainId: string;
  poolCoins?: number;
}): Promise<void> {
  const detail = redactForDiscord(input.message);
  const fields: RushEmbed["fields"] = [
    { name: "Pilot", value: `**${input.nickname}**`, inline: true },
    {
      name: "Pool",
      value: input.poolCoins != null ? formatCoins(input.poolCoins) : "—",
      inline: true,
    },
    { name: "Rain", value: shortRainId(input.rainId), inline: true },
  ];
  if (detail && !/^joined rain/i.test(detail)) {
    fields.push({ name: "Note", value: detail.slice(0, 900), inline: false });
  }

  await deliverEmbed({
    title: input.success ? "Rain — Joined" : "Rain — Failed",
    description: input.success
      ? "Successfully entered the rain join window."
      : "Could not join this rain batch.",
    color: input.success ? COLORS.rainOk : COLORS.rainFail,
    fields,
    footer: { text: "Rain join" },
  });
}

export async function reportRainJoinSummary(detail: string | null): Promise<void> {
  const parts = parseRainSummaryDetail(detail ? redactForDiscord(detail) : null);
  const fields: RushEmbed["fields"] =
    parts.length > 0
      ? parts.map((p) => ({ name: p.label, value: p.value.slice(0, 1024), inline: p.label.length < 12 }))
      : [{ name: "Summary", value: detail?.slice(0, 900) ?? "—", inline: false }];

  await deliverEmbed({
    title: "Rain batch — Summary",
    description: "End-of-rain join stats for this pool.",
    color: COLORS.rainSummary,
    fields,
    footer: { text: "Rain telemetry" },
  });
}

export async function reportLimboSkipped(input: {
  nickname: string;
  reason: string;
  rainId?: string | null;
}): Promise<void> {
  await deliverEmbed({
    title: "Limbo — Skipped",
    description: redactForDiscord(input.reason),
    color: COLORS.limboSkip,
    fields: [
      { name: "Pilot", value: `**${input.nickname}**`, inline: true },
      ...(input.rainId ? [{ name: "Rain", value: shortRainId(input.rainId), inline: true }] : []),
    ],
    footer: { text: "Post-rain limbo" },
  });
}

export async function reportRainAlert(input: {
  nickname: string | null;
  title: string;
  body: string;
  rainId?: string | null;
}): Promise<void> {
  const fields: RushEmbed["fields"] = [];
  if (input.nickname) fields.push({ name: "Pilot", value: `**${input.nickname}**`, inline: true });
  if (input.rainId) fields.push({ name: "Rain", value: shortRainId(input.rainId), inline: true });
  fields.push({ name: "Detail", value: redactForDiscord(input.body).slice(0, 900), inline: false });

  await deliverEmbed({
    title: input.title,
    color: COLORS.rainFail,
    fields,
    footer: { text: "Rain" },
  });
}

export async function reportAccountSnapshot(reason: string): Promise<void> {
  const accounts = listAccounts();
  const fields =
    accounts.length === 0
      ? [{ name: "Accounts", value: "_None configured_", inline: false }]
      : accounts.slice(0, 12).map((a) => {
          const flags = [
            a.join_rain ? "🌧️ rain" : null,
            a.auto_open_cases ? "📦 cases" : null,
            a.auto_redeem_codes ? "🎟️ codes" : null,
            a.limbo_wager_enabled ? "🎲 limbo" : null,
          ]
            .filter(Boolean)
            .join(" · ");
          return {
            name: a.nickname,
            value: `${flags || "_no toggles_"} · \`${a.status}\``,
            inline: true,
          };
        });

  await deliverEmbed({
    title: "Pilot roster",
    description: redactForDiscord(reason),
    color: COLORS.info,
    fields,
    footer: { text: "Accounts" },
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
    title: "Connection test",
    description:
      "Webhook relay is working. You will get **structured embeds** for rain joins, batch summaries, and limbo wagers.",
    color: COLORS.info,
    fields: [
      { name: "Rain", value: "Join + batch summary cards", inline: true },
      { name: "Limbo", value: "Hit/miss with balance delta", inline: true },
      { name: "Noise", value: "Captcha chatter hidden by default", inline: true },
    ],
  });
  return { ok: true };
}
