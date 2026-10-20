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

## No license

Friends mode skips the vendor relay and license flow. Do not set `DISCORD_BOT_RELAY_URL` unless you switch to the commercial bot later.
