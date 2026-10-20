/**
 * One-time: put your webhook in .env as DISCORD_REPORT_WEBHOOK=..., then:
 *   npm run setup-discord-webhook
 * Sends a test embed to Discord (does not print your URL).
 */
import "../src/bootstrap-env.js";
import { fetch } from "undici";
import { getDb } from "../src/db/database.js";
import {
  applyDiscordWebhookFromEnv,
  resolveDiscordReportWebhookUrl,
} from "../src/discord/report-webhook.js";

async function main(): Promise<void> {
  getDb();
  applyDiscordWebhookFromEnv();
  const url = resolveDiscordReportWebhookUrl();
  if (!url) {
    console.error(
      "No webhook found.\n\n1. Discord → your channel → Edit → Integrations → Webhooks → New webhook → Copy URL\n2. In ~/rush-pilot/.env add:\n   DISCORD_REPORT_WEBHOOK=https://discord.com/api/webhooks/...\n3. Run this again.",
    );
    process.exit(1);
  }

  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      embeds: [
        {
          title: "Rush Pilot",
          description: "Webhook is wired. You will get rain, captcha, and join alerts here when `npm run dev` is running.",
          color: 0x8b_5c_f6,
          timestamp: new Date().toISOString(),
        },
      ],
    }),
  });

  if (!res.ok) {
    console.error("Discord rejected the webhook:", res.status, await res.text().catch(() => ""));
    process.exit(1);
  }
  console.log("OK — check your Discord channel for the test message.");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
