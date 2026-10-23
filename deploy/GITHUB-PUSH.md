# GitHub vs Cursor remote

- **VPS** (`/opt/rorush-automation`) should pull from **`https://github.com/primary-yk/rorush-automation`**.
- Cloud agent commits often land on **Cursor `origin` first** — they are **not** on GitHub until you run **`npm run push-github`**.

## Push to GitHub

Token lives in **`deploy/github-push.env`** (gitignored — GitHub rejects PATs in commits). Copy from example once:

```bash
cp deploy/github-push.env.example deploy/github-push.env
# edit deploy/github-push.env
npm run push-github
```

On the VPS, create the same file after `git pull` so `npm run push-github` works there too.

Override with env: `export GITHUB_TOKEN=ghp_… && npm run push-github`

## VPS after GitHub has main

```bash
cd /opt/rorush-automation
git pull origin main
npm run build
pm2 restart rorush-automation --update-env
pm2 logs rorush-automation --lines 30 --nostream | grep friends-bot
```

Look for: `slash commands registered on guild`
