# Publishing Rush Pilot as Discord-first

Sell **one hosted Discord bot** + a **desktop engine** customers run at home. Many users never open the website — they live in their **private thread** and slash commands.

## What you host (seller)

| Piece | Where |
|--------|--------|
| Discord application + bot | Your VPS (`npm run discord-bot`) |
| WebSocket relay | `wss://relay.yourdomain.com/pilot` → port `43125` |
| License keys | You issue via `scripts/issue-license.ts` |

See [DISCORD-BOT.md](./DISCORD-BOT.md) for env vars and permissions.

## What the customer runs (their PC)

| Piece | Purpose |
|--------|---------|
| `npm run activate-license -- --key 'RP1…'` | Unlock engine + relay (no website) |
| `npm run dev` | RoRush automation + relay outbound |
| `.env` | `DISCORD_BOT_RELAY_URL`, captcha, encryption |

RoRush **passwords stay on their disk** (encrypted). Your relay only carries **commands and event text**, not stored credentials — except when they use `/account add`, the password transits **their PC ↔ your relay over WSS** once; do not log relay payloads.

## Customer journey (no dashboard)

1. Purchase → receive **RP1…** key  
2. Install Rush Pilot → configure `.env`  
3. `npm run activate-license -- --key '…'`  
4. `npm run dev` → `[relay] connected`  
5. In your Discord server: **`/activate`** → private thread  
6. **`/account add`** (ephemeral — only they see it)  
7. **`/rain account:Main on:true`**  
8. Watch rain / errors / limbo in the thread  

Optional: local dashboard at `http://127.0.0.1:43123` for power users.

## Bot commands (customer-facing)

| Command | Purpose |
|---------|---------|
| `/setup` | Install checklist |
| `/help` | Full Discord-first guide |
| `/activate` | License + private thread |
| `/status` | Pause state, account count |
| `/accounts` | Balance, level, toggles, errors |
| `/stats` | One account balance/level |
| `/logs` | Recent engine activity |
| `/rain` / `/cases` | Toggle automation |
| `/account add` | Save RoRush login on PC |
| `/license` | Store key on PC while online |
| `/pause` / `/resume` | Global kill switch |

## Live feed in the thread

- Rain stage, captcha, join success/fail  
- Limbo wagers (hit/miss)  
- Batched activity lines (`kind: activity`)  
- Structured rain/limbo embeds  

## Website role when you publish

- **Marketing / download** page (optional)  
- **License purchase** (your storefront)  
- Dashboard bundled for ops/debug — not required for Discord-only users  

Position the product as: **“Rush Pilot for Discord — run the engine at home, control everything from your thread.”**
