import { fetch } from "undici";
import { listAccounts } from "../db/repositories.js";
import { isRelayConnected, sendPilotEvent } from "../relay/pilot-client.js";
import { redactForDiscord } from "./public-alert-filter.js";
import { friendsDiscordBrandingEnabled } from "./friends-branding.js";
import {
  deliverFriendsReporterEmbed,
  friendsServerFeedActive,
  hostLogChannelConfigured,
  postToHostLogChannel,
} from "./friends-feed.js";
import { dmHostEmbeds, isFriendsHostMode } from "./host-alerts.js";
import { preferFriendsBotFeedsOverWebhook } from "./friends-reporting.js";
import { resolveDiscordReportWebhookUrl } from "./report-webhook.js";
import { classifyRainJoinFailure, type RainJoinFailureKind } from "../automation/rain-join.js";
import {
  COLORS,
  formatBalanceChange,
  formatCoins,
  formatMultiplier,
  limboOutcomeEmbedCopy,
  parseRainSummaryDetail,
  rainJoinEmbedCopy,
  shortRainId,
  withBrand,
  type RushEmbed,
} from "./embeds.js";

function rainJoinFailureEmbedCopy(kind: RainJoinFailureKind): {
  title: string;
  description: string;
  color: number;
} {
  switch (kind) {
    case "wager":
      return {
        title: "Rain · Wager required",
        description:
          "RoRush blocked join until wager is cleared. An automatic **limbo** bet is being placed, then join retries.",
        color: COLORS.rainSummary,
      };
    case "wager_after_limbo":
      return {
        title: "Rain · Join failed (wager)",
        description:
          "Join is still blocked **after** an automatic limbo wager. Check balance, limbo multiplier (min 1.3×), or try a manual `/limbo test`.",
        color: COLORS.rainFail,
      };
    case "wager_limbo_off":
      return {
        title: "Rain · Join blocked (wager)",
        description:
          "This account needs a wager before rain join. Turn on **`/limbo set on:true`** (or enable pre-rain wager in **`/limbo filters`**).",
        color: COLORS.rainFail,
      };
    case "captcha":
      return {
        title: "Rain · Captcha issue",
        description:
          "hCaptcha / 2Captcha did not complete a valid join for this pool. This is **not** a wager issue — check API key balance and host logs.",
        color: COLORS.rainFail,
      };
    case "funcoin":
      return {
        title: "Rain · FunCoins wallet",
        description:
          "RoRush blocked join because the account was on **FunCoins**. Real rains need **real coins** — the bot switches back **only when it detects FunCoins**, not every rain.",
        color: COLORS.rainFail,
      };
    case "pool_filter":
      return {
        title: "Rain · Skipped (pool filter)",
        description: "Pool size is below this account’s minimum rain filter.",
        color: COLORS.limboSkip,
      };
    default:
      return {
        title: "Rain · Join failed",
        description: "This account could not join the current rain.",
        color: COLORS.rainFail,
      };
  }
}

function webhookConfigured(): string | null {
  return resolveDiscordReportWebhookUrl();
}

function accountFieldLabel(): string {
  return friendsDiscordBrandingEnabled() ? "Pilot" : "Account";
}

async function deliverEmbed(
  embed: RushEmbed,
  ctx?: { accountId?: number | null; nickname?: string | null },
): Promise<void> {
  const payload = withBrand(embed, embed.color ?? COLORS.info);
  if (friendsServerFeedActive()) {
    const routed = await deliverFriendsReporterEmbed(payload, ctx);
    if (routed) return;
  }
  if (preferFriendsBotFeedsOverWebhook()) {
    if (hostLogChannelConfigured()) {
      await postToHostLogChannel([payload]);
    } else {
      await dmHostEmbeds([payload]);
    }
    return;
  }
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
  if (!url) {
    if (isFriendsHostMode()) {
      if (hostLogChannelConfigured()) {
        await postToHostLogChannel([payload]);
      } else {
        await dmHostEmbeds([payload]);
      }
      return;
    }
    return;
  }
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
  if (friendsServerFeedActive()) {
    for (const embed of stamped) {
      await deliverFriendsReporterEmbed(embed);
    }
    return;
  }
  if (preferFriendsBotFeedsOverWebhook()) {
    if (hostLogChannelConfigured()) {
      await postToHostLogChannel(stamped);
    } else {
      await dmHostEmbeds(stamped);
    }
    return;
  }
  if (isRelayConnected()) {
    for (const embed of stamped) {
      sendPilotEvent({ type: "event", kind: "activity", embed });
    }
    return;
  }
  const url = webhookConfigured();
  if (!url) {
    if (isFriendsHostMode()) {
      if (hostLogChannelConfigured()) {
        await postToHostLogChannel(stamped);
      } else {
        await dmHostEmbeds(stamped);
      }
      return;
    }
    return;
  }
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
  const resultMult =
    input.crashMultiplier != null ? formatMultiplier(input.crashMultiplier) : "—";
  const { title, description: headline } = limboOutcomeEmbedCopy({
    hit: input.hit,
    targetMultiplier: input.targetMultiplier,
    resultMultiplier: input.crashMultiplier ?? null,
  });

  const fields: RushEmbed["fields"] = [
    { name: accountFieldLabel(), value: `**${input.nickname}**`, inline: true },
    { name: "Wager", value: formatCoins(input.betCoins), inline: true },
    { name: "Set ×", value: formatMultiplier(input.targetMultiplier), inline: true },
    { name: "Result ×", value: resultMult, inline: true },
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
    fields.push({ name: "Note", value: redactForDiscord(input.reasonLabel), inline: false });
  }
  if (input.rainId && input.rainId !== "test-limbo") {
    fields.push({ name: "Rain ID", value: shortRainId(input.rainId), inline: false });
  }

  await deliverEmbed(
    {
      title,
      description: headline,
      color: input.hit ? COLORS.limboHit : COLORS.limboMiss,
      fields,
      footer: { text: "Limbo" },
    },
    { nickname: input.nickname },
  );
}

export async function reportRainManualWagerClearRequired(input: {
  nickname: string;
  rainId: string;
  balanceCoins: number;
  minBetCoins: number;
}): Promise<void> {
  await deliverEmbed(
    {
      title: "Rain · Wager lock (manual)",
      description:
        "RoRush still requires **play-through** before rain join. Your wallet is below the **limbo minimum bet**, so the bot tried once and turned **auto limbo off**.\n\n" +
        "Clear wager on **rorush.com**, deposit if needed, then run **`/limbo set on:true`** on this account.",
      color: COLORS.rainFail,
      fields: [
        { name: accountFieldLabel(), value: `**${input.nickname}**`, inline: true },
        { name: "Wallet", value: formatCoins(input.balanceCoins), inline: true },
        { name: "Limbo min bet", value: formatCoins(input.minBetCoins), inline: true },
        { name: "Rain ID", value: shortRainId(input.rainId), inline: false },
      ],
      footer: { text: "Rain · wager lock" },
    },
    { nickname: input.nickname },
  );
}

export async function reportRainWagerClearing(input: {
  nickname: string;
  rainId: string;
  poolCoins?: number;
  siteMessage?: string;
}): Promise<void> {
  const copy = rainJoinFailureEmbedCopy("wager");
  const fields: RushEmbed["fields"] = [
    { name: accountFieldLabel(), value: `**${input.nickname}**`, inline: true },
    {
      name: "Pool",
      value: input.poolCoins != null ? formatCoins(input.poolCoins) : "—",
      inline: true,
    },
    { name: "Rain ID", value: shortRainId(input.rainId), inline: true },
  ];
  const site = input.siteMessage ? redactForDiscord(input.siteMessage) : "";
  if (site && !isWagerSiteMessage(site)) {
    fields.push({ name: "RoRush", value: site.slice(0, 400), inline: false });
  }

  await deliverEmbed(
    {
      title: copy.title,
      description: copy.description,
      color: copy.color,
      fields,
      footer: { text: "Rain · wager" },
    },
    { nickname: input.nickname },
  );
}

function isWagerSiteMessage(message: string): boolean {
  return /wager|play.?through|requirement|must bet|bet before/i.test(message);
}

export async function reportRainOutcome(input: {
  nickname: string;
  success: boolean;
  message: string;
  rainId: string;
  poolCoins?: number;
  wagerClearAttempted?: boolean;
}): Promise<void> {
  const detail = redactForDiscord(input.message);
  const fields: RushEmbed["fields"] = [
    { name: accountFieldLabel(), value: `**${input.nickname}**`, inline: true },
    {
      name: "Pool",
      value: input.poolCoins != null ? formatCoins(input.poolCoins) : "—",
      inline: true,
    },
    { name: "Rain ID", value: shortRainId(input.rainId), inline: true },
  ];

  let title: string;
  let description: string;
  let color: number;

  if (input.success) {
    const rainCopy = rainJoinEmbedCopy(true);
    title = rainCopy.title;
    description = rainCopy.description;
    color = COLORS.rainOk;
    if (detail && !/^joined rain/i.test(detail)) {
      fields.push({ name: "Note", value: detail.slice(0, 900), inline: false });
    }
  } else {
    let kind = classifyRainJoinFailure(detail, {
      wagerClearAttempted: input.wagerClearAttempted,
    });
    if (/manual wager clear required/i.test(detail)) {
      kind = "wager_limbo_off";
    }
    const failCopy = rainJoinFailureEmbedCopy(kind);
    title = failCopy.title;
    description = failCopy.description;
    color = failCopy.color;
    if (kind === "funcoin") {
      title = "Rain · FunCoins (permission denied)";
      description =
        "Account wallet was on **FunCoins** — rain joins only work on **real coins**. Bot switches back only when it detects FunCoins; confirm on rorush.com if failures continue.";
    } else if (kind === "captcha") {
      if (/not ready before the join window/i.test(detail)) {
        title = "Rain · Captcha not ready";
        description =
          "2Captcha did not finish before the join window closed. Top up **2Captcha**, confirm **CAPTCHA_API_KEY** in `.env`, and watch **#host-log** for solve errors.";
      } else if (/after submitting captcha/i.test(detail)) {
        title = "Rain · Captcha rejected";
        description =
          "A captcha token was sent but RoRush did not confirm the join. The next rain will request a **fresh** solve automatically.";
      }
    }
    const noteLabel =
      kind === "captcha"
        ? "Site message"
        : kind === "wager" || kind === "wager_after_limbo" || kind === "wager_limbo_off"
          ? "RoRush"
          : "Note";
    if (detail && !/^joined rain/i.test(detail)) {
      fields.push({ name: noteLabel, value: detail.slice(0, 900), inline: false });
    }
  }

  await deliverEmbed(
    {
      title,
      description,
      color,
      fields,
      footer: { text: "Rain" },
    },
    { nickname: input.nickname },
  );
}

export async function reportRainJoinSummary(detail: string | null): Promise<void> {
  const parts = parseRainSummaryDetail(detail ? redactForDiscord(detail) : null);
  const fields: RushEmbed["fields"] =
    parts.length > 0
      ? parts.map((p) => ({ name: p.label, value: p.value.slice(0, 1024), inline: p.label.length < 12 }))
      : [{ name: "Summary", value: detail?.slice(0, 900) ?? "—", inline: false }];

  await deliverEmbed({
    title: "Rain · Batch summary",
    description: "Join stats for the pool that just finished.",
    color: COLORS.rainSummary,
    fields,
    footer: { text: "Rain" },
  });
}

export async function reportLimboSkipped(input: {
  nickname: string;
  reason: string;
  rainId?: string | null;
}): Promise<void> {
  await deliverEmbed(
    {
      title: "Limbo · Not placed",
      description: redactForDiscord(input.reason),
      color: COLORS.limboSkip,
      fields: [
        { name: accountFieldLabel(), value: `**${input.nickname}**`, inline: true },
        ...(input.rainId ? [{ name: "Rain ID", value: shortRainId(input.rainId), inline: true }] : []),
      ],
      footer: { text: "Limbo" },
    },
    { nickname: input.nickname },
  );
}

export async function reportCaptchaBalanceLow(input: {
  balanceUsd: number;
  thresholdUsd: number;
  provider: string;
}): Promise<void> {
  await deliverEmbed({
    title: "Captcha balance low",
    description: `Add funds to **${input.provider}** so rain joins do not fail mid-window.`,
    color: COLORS.rainFail,
    fields: [
      { name: "Balance", value: `$${input.balanceUsd.toFixed(2)}`, inline: true },
      { name: "Alert below", value: `$${input.thresholdUsd.toFixed(2)}`, inline: true },
    ],
    footer: { text: "2Captcha / CapSolver" },
  });
}

export async function reportRainJoinWindowOpen(input: {
  rainId: string;
  poolCoins: number | null;
  captchaReady: number;
  captchaSolving?: number;
  captchaTotal: number;
  windowSec: number;
}): Promise<void> {
  const solving = input.captchaSolving ?? 0;
  const desc =
    input.captchaReady >= input.captchaTotal
      ? "All captcha tokens ready — joining pilots now."
      : solving > 0
        ? `${solving} solve(s) already running on 2Captcha. **0 ready at window open is normal** — joins fire when tokens land.`
        : "Join stage is live. Waiting on 2Captcha (check balance if this stays 0/ready).";
  await deliverEmbed({
    title: "Rain — Join window open",
    description: desc,
    color: COLORS.rainOk,
    fields: [
      { name: "Pool", value: input.poolCoins != null ? formatCoins(input.poolCoins) : "—", inline: true },
      {
        name: "Captchas",
        value:
          solving > 0
            ? `${input.captchaReady}/${input.captchaTotal} ready · ${solving} solving`
            : `${input.captchaReady}/${input.captchaTotal} ready`,
        inline: true,
      },
      { name: "Window", value: `~${input.windowSec}s`, inline: true },
      { name: "Rain", value: shortRainId(input.rainId), inline: false },
    ],
    footer: { text: "Rain join" },
  });
}

export async function reportRainAlert(input: {
  nickname: string | null;
  title: string;
  body: string;
  rainId?: string | null;
}): Promise<void> {
  const fields: RushEmbed["fields"] = [];
  if (input.nickname) {
    fields.push({ name: accountFieldLabel(), value: `**${input.nickname}**`, inline: true });
  }
  if (input.rainId) fields.push({ name: "Rain", value: shortRainId(input.rainId), inline: true });
  fields.push({ name: "Detail", value: redactForDiscord(input.body).slice(0, 900), inline: false });

  await deliverEmbed(
    {
      title: input.title,
      color: COLORS.rainFail,
      fields,
      footer: { text: "Rain" },
    },
    { nickname: input.nickname },
  );
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
