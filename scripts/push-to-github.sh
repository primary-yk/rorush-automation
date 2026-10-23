#!/usr/bin/env bash
# Push main to https://github.com/primary-yk/rorush-automation (what the VPS pulls).
# Usage (do not paste token in chat — use env):
#   export GITHUB_TOKEN=ghp_xxxxxxxx
#   npm run push-github
set -euo pipefail
cd "$(dirname "$0")/.."
if [[ -z "${GITHUB_TOKEN:-}" ]]; then
  echo "Set GITHUB_TOKEN (GitHub PAT with repo scope), then re-run."
  exit 1
fi
git push "https://x-access-token:${GITHUB_TOKEN}@github.com/primary-yk/rorush-automation.git" main:main
echo "OK — on VPS: cd /opt/rorush-automation && git pull origin main && npm run build && pm2 restart rorush-automation --update-env"
