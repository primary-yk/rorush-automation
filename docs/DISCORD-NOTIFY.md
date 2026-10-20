# Discord notifications (self-hosted)

Mirror **rain**, **limbo wagers**, **case opens**, **captcha errors**, and **join results** to Discord while `npm run dev` runs.

## Option A — Channel webhook (easiest)

1. Discord → your server → pick a channel (e.g. `#rush-pilot-logs`).
2. Edit channel → **Integrations** → **Webhooks** → **New webhook** → copy URL.
3. Dashboard → **Settings** → **Discord notifications**:
   - Turn on **Send to Discord**
   - Paste webhook URL → **Save webhook** → **Send test**
4. Optional: **Full activity feed** posts more system lines (noisier).

Rain and errors are always sent when **Send to Discord** is on, even without full feed.

## Option B — Your bot posts to a channel

1. [Discord Developer Portal](https://discord.com/developers/applications) → New app → **Bot** → copy token.
2. Invite bot to your server (Send Messages permission).
3. Enable **Developer Mode** in Discord → right-click channel → **Copy channel ID**.
4. In `~/rush-pilot/.env`:

```env
DISCORD_BOT_TOKEN=your_bot_token
DISCORD_ACTIVITY_CHANNEL_ID=123456789012345678
```

5. Restart `npm run dev`.

You can use **webhook + bot** together; both receive batched activity.

## Option C — Vendor Rush Pilot bot (private thread)

For licensed setups with `DISCORD_BOT_RELAY_URL` and `/activate` — see [DISCORD-BOT.md](./DISCORD-BOT.md). Activity also streams to your private thread when the relay is connected.

## What gets posted

| Source | Examples |
|--------|----------|
| Rain | Join stage, captcha, join sent, joined / failed |
| Limbo | Wager for rain requirement, hit / miss |
| Cases | Opens, skips, errors |
| System | Engine start, captcha/timeouts, balance refresh errors |

Messages are **batched ~1.2s** so fast rain updates do not flood Discord.

## Code watcher (separate)

**Discord code watcher** in Settings still uses a **user token** to read a promo channel — that is not the same as notification webhooks.
