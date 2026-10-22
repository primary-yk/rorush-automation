#!/usr/bin/env bash
# Run on VPS as root from anywhere — updates /opt/rorush-automation captcha stack.
set -euo pipefail
cd /opt/rorush-automation

pm2 stop rorush-automation 2>/dev/null || true
git fetch origin main
git reset --hard origin/main
echo "Commit: $(git log -1 --oneline)"

set_env() {
  local k="$1" v="$2"
  if grep -q "^${k}=" .env 2>/dev/null; then
    sed -i "s|^${k}=.*|${k}=${v}|" .env
  else
    echo "${k}=${v}" >> .env
  fi
}

set_env CAPTCHA_RAIN_DUAL_START 0
set_env CAPTCHA_RAIN_HEDGE_AFTER_MS 0
set_env CAPTCHA_RAIN_LATE_PARALLEL 1
set_env CAPTCHA_RAIN_CANCEL_AFTER_MS 0
set_env CAPTCHA_SOLVE_START_LEAD_MS 120000
set_env RAIN_DEFAULT_TIP_STAGE_MS 300000
set_env RAIN_PREP_TICK_MS 5000
set_env CAPTCHA_POLL_MS 1000
set_env CAPTCHA_RAIN_TASK_ATTEMPTS 1
set_env CAPTCHA_RAIN_MAX_TASKS_PER_SLOT 3
set_env RAIN_CAPTCHA_URGENT_FAIL_COOLDOWN_MS 8000

npm run build
pm2 delete rorush-automation 2>/dev/null || true
pm2 start ecosystem.config.cjs --only rorush-automation --update-env
pm2 save

echo ""
echo "OK — next rain log should NOT show 'staggered' dual-start. On Rain created look for: join ~180-300s"
echo "Errors: cd /opt/rorush-automation && npm run last-rain-errors"
