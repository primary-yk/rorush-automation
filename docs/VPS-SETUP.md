# Run RoRush Automation on a VPS (beginner guide)

A **VPS** is a small Linux computer in the cloud that stays on 24/7. You connect from your laptop with **SSH**, install this project once, and it keeps running rain/cases while your PC is off.

You do **not** need to send captchas to anyone. Put your **CapMonster API key** in `.env` and the bot solves captchas the same way the site expects.

---

## 1. Pick a VPS provider

Any cheap Linux VPS works. Examples (pick one; all have “Create server” wizards):

- [Hetzner](https://www.hetzner.com/cloud) — CX22 or similar (~€4/mo)
- [DigitalOcean](https://www.digitalocean.com) — Basic Droplet
- [Vultr](https://www.vultr.com) — Cloud Compute

When creating the server:

| Setting | Choose |
|--------|--------|
| OS | **Ubuntu 24.04** (or 22.04) |
| Size | 1 GB RAM minimum, **2 GB RAM** recommended |
| Region | Closest to you |
| Login | **SSH key** (best) or password emailed to you |

Write down the **public IP address** (example: `203.0.113.50`).

---

## 2. Connect from your computer (SSH)

### Mac / Linux

Open Terminal:

```bash
ssh root@YOUR_SERVER_IP
```

Replace `YOUR_SERVER_IP` with the IP from the provider. Accept the fingerprint (`yes`). Enter password if you use password login.

### Windows

- Install [Windows Terminal](https://aka.ms/terminal) or use PuTTY.
- Host: `YOUR_SERVER_IP`, user: `root` (or `ubuntu` on some images).

You should see a prompt like `root@ubuntu:~#`. You are now **on the VPS**.

---

## 3. Install Node.js on the VPS

Copy-paste this whole block on the VPS:

```bash
apt update && apt upgrade -y
curl -fsSL https://deb.nodesource.com/setup_20.x | bash -
apt install -y nodejs git
node -v
npm -v
```

You should see Node **v20.x**.

---

## 4. Get the project onto the VPS

**If your code is on GitHub** (after you click “Create repo” in Cursor):

```bash
cd /opt
git clone https://github.com/YOUR_USER/YOUR_REPO.git rorush-automation
cd rorush-automation
```

**If you only have a zip from Cursor:** upload it with SFTP (FileZilla, Cyberduck) to `/opt/rorush-automation`, then:

```bash
cd /opt/rorush-automation
npm install
```

---

## 5. Configure `.env` (secrets stay on **your** VPS)

```bash
cp .env.example .env
nano .env
```

Set at least:

```env
ENCRYPTION_KEY=paste_output_of_openssl_rand_below
CAPMONSTER_API_KEY=your_capmonster_key
AUTOMATION_API_HOST=127.0.0.1
AUTOMATION_API_PORT=43124
```

Generate the encryption key on the VPS:

```bash
openssl rand -base64 32
```

Paste that into `ENCRYPTION_KEY=` in `.env`.

In `nano`: edit, then **Ctrl+O** Enter to save, **Ctrl+X** to exit.

Optional (only if rain/captcha fails without them — copy from RoRush in browser DevTools):

```env
RORUSH_HCAPTCHA_SITEKEY=
RORUSH_TURNSTILE_SITEKEY=
```

---

## 6. Build and run in the background (PM2)

Still in the project folder:

```bash
npm install
npm run build
npm install -g pm2
pm2 start ecosystem.config.cjs
pm2 save
pm2 startup
```

Run the command `pm2 startup` prints (starts the app after reboot).

Check status:

```bash
pm2 status
pm2 logs
```

---

## 7. Open the dashboard safely

By default the dashboard listens on **127.0.0.1** only (not exposed to the whole internet). Two options:

### Option A — SSH tunnel (easiest, no firewall drama)

On **your laptop** (new terminal, not on the VPS):

```bash
ssh -L 43123:127.0.0.1:43123 root@YOUR_SERVER_IP
```

Leave that open. On your laptop open:

**http://127.0.0.1:43123**

Your traffic is encrypted through SSH. Good for beginners.

### Option B — Public URL with password (advanced)

Use a reverse proxy + HTTPS (Caddy/Nginx) and **strong auth**. Not covered here; ask if you need this later.

**Do not** expose port 43123 to `0.0.0.0` without HTTPS and login — anyone could add accounts.

---

## 8. Use the dashboard (same as local)

1. Add account: nickname + RoRush **email/password** (or session JWT).
2. Turn on **Join rain** / **Auto-open cases** as you like.
3. **Global pause** stops everything without deleting accounts.

Data lives in `./data/rorush-automation.db` on the VPS. Back up that file if you rebuild the server.

---

## 9. Useful commands

| Task | Command (on VPS, in project folder) |
|------|-------------------------------------|
| View logs | `pm2 logs` |
| Restart after `.env` change | `pm2 restart all` |
| Stop | `pm2 stop all` |
| Update code | `git pull && npm install && npm run build && pm2 restart all` |

---

## Captcha — what you actually do

1. Create account at [capmonster.cloud](https://capmonster.cloud) (or compatible service).
2. Add balance / subscription.
3. Copy **API key** → `CAPMONSTER_API_KEY` in `.env` on the VPS.
4. Restart: `pm2 restart all`.

You never paste captcha images into chat. The automation requests a token from CapMonster when RoRush asks for hCaptcha/Turnstile.

---

## Checklist

- [ ] VPS created (Ubuntu, 2 GB RAM)
- [ ] SSH works
- [ ] Node 20 installed
- [ ] Repo cloned, `npm install`, `.env` with `ENCRYPTION_KEY` + `CAPMONSTER_API_KEY`
- [ ] `npm run build` && `pm2 start ecosystem.config.cjs`
- [ ] Dashboard via SSH tunnel: `ssh -L 43123:127.0.0.1:43123 ...`
- [ ] Account added in dashboard, toggles on

---

## Disclaimer

Automating RoRush may break their terms. Use one account you accept losing. This project is not affiliated with RoRush.
