# Friends mode (you host, they use Discord only)

**Priority checklist (duplicate captcha, limbo mult, no URL leaks):** [PRIORITIES-STATUS.md](./PRIORITIES-STATUS.md)

**3–4 friends, no sales:** keep **`HOSTED_SAAS` unset**, leave **`RUSH_PILOT_LICENSE` empty**, and **do not** set `DISCORD_BOT_RELAY_URL`. Friends never see `/license` — they go straight to `/account add`.

Minimal `.env` (you):

```env
ENCRYPTION_KEY=...
CAPTCHA_API_KEY=...
CAPTCHA_PROVIDER=2captcha
DISCORD_BOT_TOKEN=...
DISCORD_GUILD_ID=...
HOST_DISCORD_USER_ID=...

# Optional: rain/error alerts to a channel (webhook from Discord → Integrations → Webhooks)
# DISCORD_REPORT_WEBHOOK=https://discord.com/api/webhooks/...
```

After adding the webhook line: `npm run setup-discord-webhook` once to verify.

### Discord bot (friends slash commands — no URLs in replies)

1. [Discord Developer Portal](https://discord.com/developers/applications) → your app → **Bot** → copy token → `DISCORD_BOT_TOKEN`
2. Developer Mode → right-click **server** → Copy ID → `DISCORD_GUILD_ID`
3. Right-click **your user** → Copy ID → `HOST_DISCORD_USER_ID`
4. OAuth2 URL Generator: scopes `bot` + `applications.commands`, permissions **Send Messages**, **Use Slash Commands**, **Embed Links**
5. `npm run discord-bot-doctor` then `npm run dev`

Friends only use `/` commands — bot replies never include dashboard or site links.

## You (host)

1. Windows: use WSL or native Node — run from project folder:
   ```bash
   npm run dev
   ```
2. `.env` must include:
   - `ENCRYPTION_KEY`, `CAPTCHA_API_KEY`, `CAPTCHA_PROVIDER=2captcha`
   - `DISCORD_BOT_TOKEN`, `DISCORD_GUILD_ID`
   - `HOST_DISCORD_USER_ID` (your Discord user id — for `/pause` `/resume`)
   - Optional: `DISCORD_ACTIVITY_CHANNEL_ID` for a public rain/error log channel
3. Open dashboard (`npm run show-urls`) to **add/remove any account**, inspect logs, global pause.

Keep **`npm run dev` running** on your PC while friends use the bot.

## Friends

No install. In your Discord server:

| Command | What it does |
|---------|----------------|
| `/setup` | Short guide |
| `/account add` | Save RoRush login (only they see it) |
| `/account remove` | Remove their account |
| `/accounts` | Balance, level, toggles |
| `/rain` / `/cases` | Turn automation on/off |
| `/limbo` | Wager on/off + multiplier + optional bet |
| `/status` | Engine summary |

They **cannot** see or change each other’s accounts.

## Invite the bot

Discord Developer Portal → Bot → **Privileged**: none required.  
OAuth2 → URL with scopes `bot`, `applications.commands` → permissions: Send Messages, Use Slash Commands, Embed Links.

## Selling access (customers never install)

If you charge for Pilot, use **hosted SaaS** — you run one server 24/7; buyers only use Discord. Full guide: **[HOSTED-SAAS.md](./HOSTED-SAAS.md)**.

| Who | Command |
|-----|---------|
| **You (host)** | Set `HOSTED_SAAS=true`, keep `npm run start` on your VPS |
| **You (seller)** | `/admin issue for:@buyer days:30` → DM the RP1 key |
| **Buyer** | `/license redeem key:RP1…` → `/account add` → `/rain` |

Do **not** tell customers to run `npm run dev`, WSL, or a local dashboard.

Free friends on your machine: leave `HOSTED_SAAS` unset — no license required.

## Legacy: vendor relay (not for sales)

`DISCORD_BOT_RELAY_URL` + separate `npm run discord-bot` was an older model where **each customer ran Pilot on their own PC**. It still exists in the repo for self-host power users, but it is **not** what you want when selling — use hosted SaaS instead. See [DISCORD-BOT.md](./DISCORD-BOT.md) only if you intentionally self-host on your own hardware.
