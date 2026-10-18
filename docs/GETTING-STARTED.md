# Start here — full walkthrough (Windows)

One section at a time.

---

## What you’re building

| Piece | What it does |
|-------|----------------|
| **Rush Pilot** | Talks to RoRush like the website — rain, cases, codes |
| **Automation engine** | Runs in the background while `npm run dev` is active |
| **Dashboard** | http://127.0.0.1:43123 — license, accounts, toggles |

Captchas use **CapMonster** (`CAPMONSTER_API_KEY` in `.env`), not manual screenshots.

---

## Phase 1 — Get the project on your PC

You should receive Rush Pilot as a **zip** or **private git clone** from whoever sold you access.

**Windows:** use **WSL (Ubuntu)** — Origin/PowerShell-only git is not required.

1. PowerShell (Admin): `wsl --install` → restart.
2. Open **Ubuntu** from Start.
3. Put the project in `~/rush-pilot` (unzip or `git clone <your-private-url>`).

---

## Phase 2 — One-time setup inside WSL

```bash
cd ~/rush-pilot
curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
sudo apt install -y nodejs
cp .env.example .env
node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"
```

Paste that output into `ENCRYPTION_KEY=` in `.env` (`nano .env` → save Ctrl+O, Enter, Ctrl+X).

If you purchased a license, you’ll paste the `RP1.…` key on the dashboard after first launch.

```bash
npm install
```

---

## Phase 3 — Run every day

```bash
cd ~/rush-pilot
npm run dev
```

Keep Ubuntu open. On **Windows**, browser: **http://127.0.0.1:43123**

Stop with **Ctrl+C** in Ubuntu.

---

## Phase 4 — Dashboard

1. **Activate license** (if prompted).
2. **Add account** — nickname + RoRush email/password (encrypted locally).
3. **Join rain** / **Auto-open cases** — per account.
4. **Global pause** — OFF when automation should run.

Optional: `CAPMONSTER_API_KEY` in `.env`, restart `npm run dev`.

---

## Help

| Symptom | Fix |
|---------|-----|
| License screen | Paste key from purchase email |
| Red banner | Run `npm run dev` in `~/rush-pilot` |
| Rain captcha fails | CapMonster key in `.env` |

Windows details: [WINDOWS-SETUP.md](./WINDOWS-SETUP.md)
