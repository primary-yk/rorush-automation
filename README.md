# Rush Pilot

Node.js + TypeScript automation for [RoRush](https://rorush.com) with an operator dashboard. It uses the same public web API and SignalR hub as the site (`https://api.rorush.com`).

## How you run it

| Goal | You | Customers / friends |
|------|-----|---------------------|
| **Sell access** | VPS + `HOSTED_SAAS=true` — [docs/HOSTED-SAAS.md](docs/HOSTED-SAAS.md) | Discord only (`/license redeem`, `/account add`, …) — **no install** |
| **Free friends** | Your PC/VPS + [docs/FRIENDS-HOST.md](docs/FRIENDS-HOST.md) | Discord only |
| **Solo on your machine** | [docs/GETTING-STARTED.md](docs/GETTING-STARTED.md) | — |

Do **not** use `DISCORD_BOT_RELAY_URL` for sales; that path expects each user to run Pilot locally (legacy self-host).

- `POST /api/v1/auth/login-email` and session JWT auth
- SignalR hub `/hub` — `SubscribeRain`, `JoinRain`, `PlayLimboGame`, `PlayCaseUnboxing`
- Rewards endpoints for daily/energy/season cases and flash codes

No encryption reverse-engineering or anti-bot bypass: captchas go through CapMonster (or compatible) when configured.

## Requirements

- Node.js 20+
- CapMonster API key (for rain join / flash codes when captcha is required)
- Optional: `RORUSH_PROXY_URL` for a shared rain listener connection

## Setup

**Start from zero (step-by-step):** **[docs/GETTING-STARTED.md](docs/GETTING-STARTED.md)**  
**Windows + WSL details:** **[docs/WINDOWS-SETUP.md](docs/WINDOWS-SETUP.md)**

1. Copy env and generate an encryption key:

```bash
cp .env.example .env
openssl rand -base64 32
# paste into ENCRYPTION_KEY=
```

2. Install and run (starts automation API + worker + dashboard):

```bash
npm install
npm run dev
```

- Dashboard: http://127.0.0.1:43123
- Automation API: http://127.0.0.1:43124

3. Put secrets in **`.env`** in this folder (not `nano.env` — that name is only a fallback). Set `CAPMONSTER_API_KEY` for rain join.

4. Sanity check:

```bash
npm run preflight          # doctor + tests
npm run test-login         # RoRush email/password or session JWT
npm run test-captcha       # CapMonster key (optional, uses balance)
```

5. Add accounts with nickname + email/password **or** paste a session JWT from DevTools (Application → localStorage / network `Authorization` header after login).

Optional env for captcha site keys (copy from DevTools when hCaptcha / Turnstile loads on rorush.com):

- `RORUSH_HCAPTCHA_SITEKEY`
- `RORUSH_TURNSTILE_SITEKEY`

## Features

| Feature | Behavior |
|--------|----------|
| Rain joiner | One shared SignalR rain subscription; joins on all opted-in accounts |
| Wager retry | Limbo bet sized to the rain pool amount (≥1.3× min — lower multipliers can leave wager lock), then retry join (up to 3×) |
| Cases | Auto-opens daily, weekly, and monthly reward cases (not energy) |
| Discord | Optional read-only channel poll; redeems new codes on opted-in accounts |
| Safety | Per-request rate limit, exponential backoff, stop after 3 failures |

## Discord bot (friends test your server)

Friends **do not** install Rush Pilot. You run `npm run dev` on your PC/VPS; the **friends bot** starts automatically when these are set in `.env`:

```env
DISCORD_BOT_TOKEN=...
DISCORD_GUILD_ID=...
HOST_DISCORD_USER_ID=...   # your Discord user id — /pause and /resume
```

Do **not** set `DISCORD_BOT_RELAY_URL` (that’s a different vendor/relay mode).

1. [Discord Developer Portal](https://discord.com/developers/applications) → Bot token + invite with **applications.commands**
2. `npm run discord-bot-doctor`
3. `npm run dev` → look for `[friends-bot] logged in`
4. Friends use `/account add`, `/rain`, `/cases`, `/help` (replies are ephemeral for passwords)

Full walkthrough: **[docs/FRIENDS-HOST.md](docs/FRIENDS-HOST.md)**

## Tests

```bash
npm test
```

Covers rain join window / wager detection and Discord code parsing.

## Production / VPS

On a server, build once and use PM2 so it survives disconnects and reboots:

```bash
npm run build
npm install -g pm2
pm2 start ecosystem.config.cjs
pm2 save && pm2 startup
```

Beginner VPS walkthrough (SSH, `.env`, CapMonster, SSH tunnel to the dashboard): **[docs/VPS-SETUP.md](docs/VPS-SETUP.md)**.

SQLite database defaults to `./data/rorush-automation.db`.

## Disclaimer

Use at your own risk. Automating third-party services may violate their terms. This project is unaffiliated with RoRush.
