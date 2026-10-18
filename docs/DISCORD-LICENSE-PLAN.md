# Discord reports + license (recommended architecture)

You want **two different Discord flows**:

| Flow | Purpose | Today |
|------|---------|--------|
| **Code watcher** | Read a *public* RoRush promo channel, redeem codes | Built (`discord/watcher.ts`) |
| **Private thread reports** | Post *your* limbo hits/misses, rain joins, account list to a thread only you see | Webhook reporter (this doc + Settings) |

Keep them separate: one uses a **user token + channel ID** (read), the other uses a **webhook URL** (write-only, safe to scope to one thread).

---

## Private thread reports (simplest — works on self-hosted PC)

**Best for:** each customer runs Rush Pilot at home; you optionally sell support where *they* get a thread on *your* server, or they use their own server.

### Setup (customer or you)

1. In Discord, open the **parent channel** (e.g. `#rush-pilot`).
2. Create a **private thread** (only the customer + you).
3. In that thread: **Edit thread → Integrations → Webhooks → New webhook** (or create webhook in thread).
4. Copy the webhook URL (`https://discord.com/api/webhooks/...`).
5. In Rush Pilot → **Settings → Discord reports**, paste URL, enable, click **Send test**.

All limbo wager outcomes, rain joins/failures, and account list snapshots post **only to that thread**. No bot hosting required.

### What gets posted

- **Limbo:** hit / miss, bet size, target multiplier, account nickname.
- **Rain:** joined / failed / timed out (after wager flow).
- **Accounts:** list of nicknames + toggles when someone adds/removes an account (no passwords).

---

## License + *your* vendor Discord (phase 2 — optional)

**Goal:** customer buys key → you auto-create a private thread on **your** support server and tie reports to their license.

### Pieces

1. **Signed license** (already have `RP1…` keys)
   - Extend payload with optional `discordUserId` when issuing:
     ```bash
     npx tsx scripts/issue-license.ts --id alice --days 365 --discord-user 123456789012345678
     ```
   - Customer still activates in the dashboard locally; payload stores who they are for *your* records.

2. **Your Discord bot** (separate small Node app — not inside Rush Pilot)
   - Slash command or ticket bot: `/activate <license-key>`
   - Verifies key with your **public** key (same as the app).
   - Creates private thread under `#pilot-clients`, adds customer by `discordUserId` from license (or asks them to OAuth link).
   - Stores `{ licenseId → threadWebhookUrl }` in your DB.

3. **Report relay (only if you don’t want webhooks on customer PC)**
   - Customer’s Pilot sends events to `https://your-api.com/v1/pilot-events` with `Authorization: Bearer <license-key>`.
   - Your API looks up thread webhook and forwards embeds.
   - **Heavier:** needs hosting, privacy policy, uptime. Use only if you must centralize logs.

**Recommendation:** start with **webhook in thread on the customer machine** (phase 1). Add vendor bot + optional relay when you sell at scale.

---

## Security notes

- **Never** put your license **private** key in Rush Pilot or in customer hands.
- **Webhook URLs are secrets** — stored encrypted like Discord tokens; treat like passwords.
- Code watcher uses a **user token** (Discord ToS risk) — reports use **webhooks** (intended for integrations).
- For multi-tenant hosted Pilot later: add login + per-user webhooks in DB; self-hosted stays single-tenant SQLite.

---

## Multi-user hosted (future)

When you VPS-host for friends:

- Auth (magic link or Discord OAuth).
- Each user → own encrypted webhook + own SQLite partition (or row-level tenant id).
- License check on engine start + optional daily re-verify.

Phase 1 self-hosted + webhook already matches “private thread with limbo + accounts” without building auth yet.
