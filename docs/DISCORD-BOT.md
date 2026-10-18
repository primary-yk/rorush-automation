# Rush Pilot Discord bot (vendor-hosted)

One **Discord application** you run 24/7. Customers choose **website** or **Discord** (or both) — same automation on their PC.

## Architecture

```
Customer PC                          Your VPS / Railway
┌─────────────────────┐             ┌──────────────────────────┐
│ npm run dev         │  WebSocket  │ npm run discord-bot      │
│ (engine + API)      │────────────►│ Discord + relay :43125   │
│ DISCORD_BOT_RELAY_URL             │ Private thread per user  │
└─────────────────────┘             └──────────────────────────┘
```

- **RoRush credentials never leave the customer PC.**
- The bot only receives **events** (limbo hit/miss, rain, account list) and **commands** (pause, status, accounts).
- Customer runs `/activate <RP1 license>` → bot creates a **private thread** and links their Discord ↔ license id.

## Vendor setup (you)

1. [Discord Developer Portal](https://discord.com/developers/applications) → New application → **Bot** → copy token.
2. Enable intents: none required beyond defaults (guild commands).
3. OAuth2 → URL generator: `bot`, `applications.commands` → invite to your support server.
4. Bot permissions on the parent channel: **View Channel**, **Send Messages**, **Create Private Threads**, **Manage Threads**, **Embed Links**.
5. Create a channel e.g. `#rush-pilot` (customers won’t spam it — each gets a private thread).
6. On the bot host `.env`:

```env
DISCORD_BOT_TOKEN=...
DISCORD_GUILD_ID=...
DISCORD_THREAD_PARENT_CHANNEL_ID=...
DISCORD_BOT_RELAY_PORT=43125
LICENSE_PUBLIC_KEY=...   # same as customer builds
```

7. Run:

```bash
npm run discord-bot
```

8. Expose relay to the internet (customers connect outbound):

   `wss://relay.yourdomain.com/pilot` → reverse-proxy to port `43125`.

## Customer setup

1. Purchase → you issue license (`scripts/issue-license.ts`), optionally `--discord-user THEIR_ID`.
2. In your Discord: `/activate license:RP1....`
3. On their PC `.env`:

```env
DISCORD_BOT_RELAY_URL=wss://relay.yourdomain.com/pilot
```

4. Activate the same license in the dashboard (stores key for relay auth).
5. `npm run dev` — console should log `[relay] connected to Discord bot`.

## Bot commands

| Command | What it does |
|---------|----------------|
| `/activate` | Link license + open private thread |
| `/status` | Pause state, account count, relay |
| `/accounts` | Nicknames, toggles, errors |
| `/pause` / `/resume` | Global automation |
| `/help` | Short guide |

## What appears in the private thread

- Limbo **hit** / **miss** (bet, target ×, result ×)
- Rain **joined** / **failed**
- **Accounts attached** when they add/remove a login

## Code watcher (promo codes)

Still separate: customer can enable **code watcher** (user token + RoRush promo channel) in Settings — that reads public codes; the **bot** is for control + reporting.

## Dev without license on dashboard

Set `PILOT_RELAY_LICENSE_KEY=RP1....` in `.env` on the PC (same key they `/activate`’d) while `LICENSE_DEV_SKIP=true`.
