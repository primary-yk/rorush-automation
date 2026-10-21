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

# Optional: rain/error alerts — private webhook and/or DMs to HOST_DISCORD_USER_ID (not friends)
# DISCORD_REPORT_WEBHOOK=https://discord.com/api/webhooks/...
# Do NOT point DISCORD_ACTIVITY_CHANNEL_ID at a channel friends can read (use DMs or a private mod channel).
# Set DISCORD_ACTIVITY_PUBLIC=1 only if you intentionally want the activity channel public.
```

After adding the webhook line: `npm run setup-discord-webhook` once to verify.

### Discord bot (friends slash commands — no URLs in replies)

1. [Discord Developer Portal](https://discord.com/developers/applications) → your app → **Bot** → copy token → `DISCORD_BOT_TOKEN`
2. Developer Mode → right-click **server** → Copy ID → `DISCORD_GUILD_ID`
3. Right-click **your user** → Copy ID → `HOST_DISCORD_USER_ID`
4. OAuth2 URL Generator: scopes `bot` + `applications.commands`, permissions **Send Messages**, **Use Slash Commands**, **Embed Links**, **Manage Channels**, **Manage Roles**, **Manage Threads**
5. `npm run discord-bot-doctor` then `npm run dev` — console must show **`[friends-bot] logged in`**
6. In Discord (staff): **`/server setup`** — creates roles, categories, channels, and permission overwrites. **Re-run** deletes previous bot-made channels/categories (including old `RUSH PILOT · …` names) and builds a fresh layout; friends open **`#connect`** again for new private feeds.
7. Auto **Rain Member** when someone joins: Developer Portal → **Server Members Intent** ON, then **restart** `npm run dev` (friends bots use GuildMembers by default). Set `DISCORD_SERVER_MEMBERS_INTENT=0` only if the Portal toggle is off. Friends always get the role via **`#connect`** / **`/connect`** too.
8. By default the bot **auto-creates a private feed when someone joins** (needs Server Members Intent + **`/server setup`** done). Set `DISCORD_AUTO_CONNECT_ON_JOIN=0` if you want them to use **`#connect`** only.

Friends only use `/` commands — bot replies never include dashboard or site links.

## You (host)

1. Windows: use WSL or native Node — run from project folder:
   ```bash
   npm run dev
   ```
2. `.env` must include:
   - `ENCRYPTION_KEY`, `CAPTCHA_API_KEY`, `CAPTCHA_PROVIDER=2captcha`
   - `DISCORD_BOT_TOKEN`, `DISCORD_GUILD_ID`
   - `HOST_DISCORD_USER_ID` (your Discord user id — `/server setup` + `/pause` `/resume`)
   - After **`/server setup`**, staff alerts (captcha, join errors, friend slash failures) go to **`#host-log`**, not DMs. Set `DISCORD_HOST_DM_ALERTS=1` only if you want **both** DMs and `#host-log`.
   - Optional legacy: `DISCORD_REPORT_WEBHOOK` if you skip `/server setup`
3. Open dashboard (`npm run show-urls`) to **add/remove any account**, inspect logs, global pause.

Keep **`npm run dev` running** on your PC while friends use the bot.

**One bot token, one machine.** Never paste `DISCORD_BOT_TOKEN` into a Cursor Cloud Agent or second PC while dev is running at home. If `/account add` errors mention **`Project folder: /workspace`**, Discord is talking to a cloud sandbox, not your `~/rush-pilot` — reset the bot token in the Developer Portal and use the new token only on your host PC.

## Friends

No install. In your Discord server:

| Command | What it does |
|---------|----------------|
| `#connect` button or `/connect` | **Rain Member** role + private thread in `#rain-feeds` (slash is **`/` → connect**, not a chat message) |
| `/guide` | Getting started (ephemeral) |
| `/help` | Full command reference |
| `/server setup` | **Staff only** — full server layout (see below) |
| `/account add` | Email + password (only they see it) |
| `/account session` | **Advanced** — session JWT from rorush.com (2FA, no password stored) |
| `/account remove` | Remove their account |
| `/account list` | Balance, level, lifetime, toggles (auto-refreshes from RoRush) |
| `/account refresh` | Manual balance/level refresh (one nickname or all yours) |
| `/account pause` / `resume` | Pause **one account** (host: any nickname; friends: own only) |
| `/rain` / `/cases` | Turn automation on/off |
| `/limbo set` | Wager on/off + multiplier + fallback bet |
| `/limbo test` | One manual test bet (real balance) |
| `/limbo filters` | Min rain pool + pre-rain wager toggle |
| `/status` | Engine summary |
| `/earnings` | Lifetime rain + cases + codes (per account + your total) |
| `/server earnings` | **Staff** — lifetime totals for every linked Discord member |
| `/jump member:…` | **Staff** — join someone's private feed thread (not auto-added) |
| `/thread restore member:…` | **Owner only** — re-add a member to their private feed after rejoin |

They **cannot** see or change each other’s accounts.

### Session JWT (`/account session`)

Same as the dashboard **Session JWT (advanced)** field: log in on **rorush.com**, open browser DevTools → **Application** → **Local Storage** (or cookies, depending on how RoRush stores it), copy the session token, paste into `/account session token:…`. The bot verifies it before saving. No password is stored; when the token expires, they paste a fresh one (remove the old nickname first, or use a new nickname).

## What `/server setup` creates (staff)

Re-run anytime to **replace** the bot layout (old INFO / FEEDS / STAFF channels and `#rain-feeds` threads are removed) and **repair roles**. The setup reply reports whether **auto Rain Member on join** is active (Portal intent + bot restarted with GuildMembers).

| Piece | Purpose |
|--------|---------|
| **Role `Rush Host`** | You — see `#host-log`, manage info channels |
| **Role `Rain Member`** | Friends after `/connect` |
| **Category `INFO`** | `#connect` (button), `#start-here`, `#commands` — **visible to everyone** (read-only) |
| **Category `PRIVATE FEEDS`** | `#rain-feeds` — **Rain Member only**; private threads from **`#connect`** / **`/connect`** |
| **Category `RUSH PILOT · HOST`** | `#host-log` — captcha failures, join errors, engine issues |

`@everyone` is denied view on all of the above; only the roles + bot can see the matching channels.

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
