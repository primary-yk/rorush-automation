# Friends mode (you host, they use Discord only)

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

## Licenses without the website

**Yes — Discord only.**

| Who | Command |
|-----|---------|
| **You (seller)** | `/admin issue` — needs `LICENSE_PRIVATE_KEY` in your `.env` (ephemeral reply with RP1 key) |
| **Customer / host** | `/license key:RP1…` — saves license on the PC running `npm run dev` (ephemeral) |

Optional: put the key in `.env` as `RUSH_PILOT_LICENSE=RP1…` before starting (no slash command).

Friends mode skips the vendor relay. Do not set `DISCORD_BOT_RELAY_URL` unless you switch to the hosted commercial bot later.

### Vendor relay mode (customers on their own PC)

Same idea: customer runs `npm run dev`, then **`/license`** in Discord (vendor bot) while Pilot is online — or `RUSH_PILOT_LICENSE` / `npm run activate-license` once. **`/activate`** links their Discord to the key for the private thread.
