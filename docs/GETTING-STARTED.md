# Start here — full walkthrough (Windows)

This is the **whole path** from zero to a running dashboard. One section at a time.

---

## What you’re building

| Piece | What it does |
|-------|----------------|
| **rush-pilot** (this repo) | Talks to RoRush like the website does — rain, cases, codes |
| **Automation engine** | Runs in the background while `npm run dev` is active |
| **Dashboard** | Web page at **http://127.0.0.1:43123** — add accounts and toggles |

You **never** send captcha screenshots to ChatGPT. You add a **CapMonster API key** in `.env` and the bot solves captchas when RoRush asks.

**Your codebase (private):** [https://cursor.com/codebase/goshennoshen/rush-pilot](https://cursor.com/codebase/goshennoshen/rush-pilot)

---

## Phase 1 — Get the code (Windows → WSL)

Origin CLI does **not** work in PowerShell. Use **WSL** (Ubuntu on Windows).

1. **PowerShell as Administrator:** `wsl --install` → restart PC.
2. Open **Ubuntu** from the Start menu.
3. In Ubuntu, paste:

```bash
curl -fsSL https://downloads.cursor.com/origin/install.sh | sh
origin auth login
origin repo clone goshennoshen/rush-pilot
cd ~/rush-pilot
```

If `origin` not found:

```bash
echo 'export PATH="$HOME/.local/bin:$PATH"' >> ~/.bashrc
source ~/.bashrc
```

Docs: [https://cursor.com/docs/origin/cli](https://cursor.com/docs/origin/cli)

---

## Phase 2 — One-time setup inside WSL

```bash
cd ~/rush-pilot
curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
sudo apt install -y nodejs
cp .env.example .env
node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"
```

Copy the output. Edit env:

```bash
nano .env
```

Set `ENCRYPTION_KEY=` to that value. Save: Ctrl+O, Enter, Ctrl+X.

Install deps:

```bash
npm install
```

---

## Phase 3 — Run every day

```bash
cd ~/rush-pilot
npm run dev
```

Keep Ubuntu open. On **Windows**, open Chrome/Edge:

**http://127.0.0.1:43123**

Stop with **Ctrl+C** in Ubuntu.

---

## Phase 4 — Dashboard (first visit)

1. **Add account** — Nickname + RoRush **email & password** (stored encrypted on your machine).
2. **Join rain** — ON to auto-join chat rains (shared listener, all opted-in accounts).
3. **Auto-open cases** — ON for daily / energy / rank cases when they unlock.
4. **Global pause** — OFF when you want automation active.

Optional: **CapMonster** — add `CAPMONSTER_API_KEY=...` in `.env`, restart `npm run dev`.

Optional: **Discord** — channel ID + your read-only user token to redeem promo codes.

---

## Phase 5 — VPS (24/7, later)

When local works, see [VPS-SETUP.md](./VPS-SETUP.md) to run on a server with PM2.

---

## Help

| Symptom | Fix |
|---------|-----|
| Red banner on dashboard | Run `npm run dev` in `~/rush-pilot` |
| Login / 2FA | Use session JWT instead of password (advanced) |
| Rain fails on captcha | CapMonster key + optional hCaptcha site key in `.env` |

Windows details: [WINDOWS-SETUP.md](./WINDOWS-SETUP.md)
