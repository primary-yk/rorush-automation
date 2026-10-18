# Windows setup (complete beginner)

You already have the project from Cursor. This guide gets it running on **your PC** — no VPS required to start.

---

## Part A — Get the project on your computer

Your project lives on Cursor as **rush-pilot** (private by default):

**https://cursor.com/codebase/goshennoshen/rush-pilot**

You can change visibility in **Settings** on that page.

On **Windows**, the **Origin CLI** does not run in PowerShell — use **WSL** (Windows Subsystem for Linux). See **Option 0** below.

**Don’t see “Create repo”?** That’s normal. Use **Option 0** (recommended on Windows), **Option 1**, or **Option 2**.

### Option 0 — Clone with Origin CLI in WSL (recommended on Windows)

1. Install **WSL** if you don’t have it: in PowerShell **as Administrator** run `wsl --install`, restart, then open **Ubuntu** from the Start menu.
2. In the **Ubuntu (WSL)** terminal, run:

```bash
# Run in WSL (Origin CLI is not available in PowerShell)
# Install the Origin CLI
curl -fsSL https://downloads.cursor.com/origin/install.sh | sh

# Sign in (also sets up git credentials)
origin auth login

# Clone the repository
origin repo clone goshennoshen/rush-pilot
```

3. If `origin` is not found after install:

```bash
echo 'export PATH="$HOME/.local/bin:$PATH"' >> ~/.bashrc
source ~/.bashrc
```

4. Continue setup **inside WSL** in the cloned folder (`~/rush-pilot` or similar): install Node in WSL (`curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash - && sudo apt install -y nodejs`), then follow Part C–D below using Linux paths.

Origin CLI docs: https://cursor.com/docs/origin/cli

### Option 1 — Open this agent in Cursor on your PC (easiest if you use Cursor desktop)

1. On your Windows PC, install **Cursor** from [https://cursor.com](https://cursor.com) and sign in with the **same account** you used for this chat.
2. Open this agent run in the browser (bookmark it):  
   **https://cursor.com/agents/bc-c72b4704-2d2e-4a5c-a4c5-63d6887859df**
3. On that page, look for one of these (wording varies by Cursor version):
   - **Open in Cursor**
   - **Checkout branch** / **Open branch**
   - **⋯** menu → open or sync code locally
4. When Cursor opens the project folder on your PC, note the path (often shown in the title bar or File → Open Recent). Use that path in PowerShell instead of `C:\rorush-automation` below.

### Option 2 — Clone with Git (works if Option 1 doesn’t)

1. Install [Git for Windows](https://git-scm.com/download/win) (defaults are fine).
2. Open **PowerShell**.
3. Run:

```powershell
cd C:\
git clone https://origin.cursor.com/git/goshennoshen/tmp-5eb3c198dbe5b3a5.git rorush-automation
cd rorush-automation
```

4. If Git asks you to sign in, use your **Cursor** / browser login when the window opens.

### Option 3 — Put it on GitHub yourself (optional)

1. Go to [https://github.com/new](https://github.com/new) → name the repo `rorush-automation` → **Create repository** (empty, no README).
2. In a **new Cursor agent chat** on that empty repo, paste: “Pull in the code from my Rorush automation agent” and link the agent URL above — or ask the agent to push this project to your new GitHub remote.
3. Then on GitHub: **Code** → **Download ZIP** → extract to `C:\rorush-automation`.

### If Cursor shows a **Create repo** pill in chat

1. Click it (creates GitHub repo automatically).
2. On GitHub: **Code** → **Download ZIP** → extract to `C:\rorush-automation`.

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
