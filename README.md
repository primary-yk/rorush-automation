# RoRush Automation (self-hosted)

Node.js + TypeScript automation module for [RoRush](https://rorush.com) with a small Next.js dashboard. It uses the same public web API and SignalR hub as the site (`https://api.rorush.com`), including:

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

3. In the dashboard, add accounts with nickname + email/password **or** paste a session JWT from DevTools (Application → localStorage / network `Authorization` header after login).

Optional env for captcha site keys (copy from DevTools when hCaptcha / Turnstile loads on rorush.com):

- `RORUSH_HCAPTCHA_SITEKEY`
- `RORUSH_TURNSTILE_SITEKEY`

## Features

| Feature | Behavior |
|--------|----------|
| Rain joiner | One shared SignalR rain subscription; joins on all opted-in accounts |
| Wager retry | On wager-related failure, one small limbo bet (≥1.1×) then one retry |
| Cases | Reads unlock times, schedules opens, sleeps until next due case |
| Discord | Optional read-only channel poll; redeems new codes on opted-in accounts |
| Safety | Per-request rate limit, exponential backoff, stop after 3 failures |

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
