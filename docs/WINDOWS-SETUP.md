# Windows setup (complete beginner)

You already have the project from Cursor. This guide gets it running on **your PC** — no VPS required to start.

---

## Part A — Get the project on your computer

### If Cursor shows a **Create repo** button

1. Click **Create repo** in the agent chat (creates a GitHub repo with this code).
2. On GitHub, click the green **Code** button → **Download ZIP**.
3. Extract the ZIP to a simple folder, e.g. `C:\rorush-automation`
4. Remember that path — you will use it in the terminal.

### If the repo already exists on GitHub

1. Install [Git for Windows](https://git-scm.com/download/win) (defaults are fine).
2. Open **PowerShell** (Start menu → type `PowerShell` → Enter).
3. Run:

```powershell
cd C:\
git clone https://github.com/YOUR_USERNAME/YOUR_REPO_NAME.git rorush-automation
cd rorush-automation
```

Replace the URL with your repo’s URL from GitHub.

---

## Part B — Install Node.js

1. Open [https://nodejs.org](https://nodejs.org)
2. Download the **LTS** installer (20.x or 22.x).
3. Run the installer → Next → accept defaults → **Install**.
4. Close and reopen PowerShell, then check:

```powershell
node -v
npm -v
```

If you see version numbers, you’re good. If “not recognized”, restart the PC once and try again.

---

## Part C — One-time project setup

Open **PowerShell** and go to your project folder (change the path if yours is different):

```powershell
cd C:\rorush-automation
```

### 1. Create `.env` from the example

```powershell
copy .env.example .env
notepad .env
```

Notepad opens. You **must** set `ENCRYPTION_KEY`.

In **another** PowerShell window (same folder):

```powershell
node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"
```

Copy the long random line it prints. In Notepad, paste it after `ENCRYPTION_KEY=` (no spaces):

```env
ENCRYPTION_KEY=paste_here
```

Optional later (for rain when captcha appears):

```env
CAPMONSTER_API_KEY=your_capmonster_key
```

Save Notepad (File → Save) and close.

### 2. Install packages

```powershell
cd C:\rorush-automation
npm install
```

Wait until it finishes (first time can take a few minutes).

---

## Part D — Run it every time you want automation

```powershell
cd C:\rorush-automation
npm run dev
```

**Leave this window open.** When it’s running:

1. Open **Chrome** or **Edge**
2. Go to: **http://127.0.0.1:43123**

That page is your **dashboard**.

### First time in the dashboard

1. **Nickname** — any name, e.g. `Main`
2. **Login email** — your RoRush email
3. **Password** — your RoRush password  
   (Do not share these with anyone in chat.)
4. Click **Save account**
5. Turn on **Join rain** / **Auto-open cases** if you want those

### Stop for the day

Click the PowerShell window and press **Ctrl+C**.

---

## Part E — Captcha (CapMonster)

You do **not** send captcha pictures to ChatGPT or Cursor.

1. Sign up at [https://capmonster.cloud](https://capmonster.cloud)
2. Add a small balance
3. Copy your **API key**
4. Open `.env` again (`notepad .env`) and set:

```env
CAPMONSTER_API_KEY=paste_key_here
```

5. Save, then run `npm run dev` again

---

## Troubleshooting (Windows)

| Problem | Fix |
|--------|-----|
| `npm is not recognized` | Reinstall Node.js, restart PC |
| Red error on dashboard | PowerShell must still be running `npm run dev` |
| `ENCRYPTION_KEY is required` | Edit `.env` and set the key (Part C) |
| Script / execution policy | Run: `Set-ExecutionPolicy -Scope CurrentUser RemoteSigned` |
| Port in use | Close other `npm run dev` windows or restart PC |

---

## When you’re ready for a VPS (24/7)

Use **[VPS-SETUP.md](./VPS-SETUP.md)** later. Start on Windows first so you know the dashboard works.

---

## You do NOT need to

- Understand TypeScript or Node
- Send captchas to an AI
- Open ports on your router for local testing
- Use Linux on your PC

You **do** need: project folder, Node.js, `.env` with `ENCRYPTION_KEY`, `npm run dev`, browser at **http://127.0.0.1:43123**.
