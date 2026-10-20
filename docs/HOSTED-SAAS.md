# Hosted SaaS (you run everything — customers never install)

This is the model when you **sell** Rush Pilot but **customers do not run Pilot on their PC**.

## Architecture

```
Your VPS / home PC (24/7)              Customers
┌────────────────────────────┐          ┌──────────────┐
│ npm run dev  (or start)    │          │ Discord only │
│ Engine + SQLite + captcha  │◄─────────│ /license     │
│ Discord bot (same process) │          │ /account add │
│ Dashboard (optional, you)  │          │ /rain /limbo │
└────────────────────────────┘          └──────────────┘
```

- All RoRush logins live **on your server** (encrypted). Each customer is isolated by **Discord user id**.
- Customers never see Ubuntu, npm, or a website unless you give them one.

## Your `.env` (operator)

```env
HOSTED_SAAS=true
LICENSE_PUBLIC_KEY=...        # from license:keygen — ships in the app
LICENSE_PRIVATE_KEY=...       # only on YOUR server — for /admin issue
DISCORD_BOT_TOKEN=...
DISCORD_GUILD_ID=...
HOST_DISCORD_USER_ID=...      # you — bypasses seat check, /admin, /pause
ENCRYPTION_KEY=...
CAPTCHA_API_KEY=...
```

Do **not** set `DISCORD_BOT_RELAY_URL` (that was for “customer runs Pilot at home”).

Run on a VPS:

```bash
npm run build && npm run start
# or: npm run dev while testing
```

Open firewall only if you want a **public dashboard**; otherwise Discord is enough.

## Selling access

1. `/admin issue for:@customer days:30` → copy RP1 key (ephemeral).
2. DM the key to the buyer.
3. They join your Discord → `/license redeem key:RP1…` → `/account add` → `/rain`.

Keys can be locked to their Discord account when you pick `for:` on issue.

## Friends vs paid

| Mode | `HOSTED_SAAS` | License |
|------|---------------|---------|
| Free friends on your PC | `false` | Not required |
| Paid hosted service | `true` | `/license redeem` required |

## What NOT to tell customers

- No `npm run dev` on their machine  
- No WSL / Ubuntu  
- No `DISCORD_BOT_RELAY_URL`  
- No local dashboard (unless you host a login portal later)

## Optional website

The bundled Next dashboard is for **you** (ops). You can hide it behind VPN or admin password later; it is not required for customers.
