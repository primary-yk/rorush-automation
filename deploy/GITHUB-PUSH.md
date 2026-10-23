# GitHub vs Cursor remote

- **VPS** (`/opt/rorush-automation`) should pull from **`https://github.com/primary-yk/rorush-automation`**.
- Cloud agent commits often land on **Cursor `origin` first** — they are **not** on GitHub until you run **`npm run push-github`**.

## One-time push (PAT in env only)

```bash
export GITHUB_TOKEN=ghp_your_pat_here
npm run push-github
```

## VPS after GitHub has main

```bash
cd /opt/rorush-automation
git pull origin main
npm run build
pm2 restart rorush-automation --update-env
pm2 logs rorush-automation --lines 30 --nostream | grep friends-bot
```

Look for: `slash commands registered on guild`
