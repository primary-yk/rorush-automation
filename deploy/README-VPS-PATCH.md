# VPS patch when GitHub is still at 9978ee0

GitHub `main` may lag behind fixes `ae7b5b2` and `ce5f3a9`. Apply locally:

```bash
cd /opt/rorush-automation
pm2 stop rorush-automation
git reset --hard HEAD
git clean -fd   # removes stray *.rej from failed manual patches
git am /path/to/spend-fix-from-9978.patch
npm run build
pm2 restart rorush-automation --update-env
git log -1 --oneline   # expect ce5f3a9
```

Copy `spend-fix-from-9978.patch` to the server with `scp` from a machine that has this repo.

After apply, set in `.env`:

```env
CAPTCHA_RAIN_DUAL_START=0
CAPTCHA_RAIN_HEDGE_AFTER_MS=0
CAPTCHA_RAIN_MAX_TASKS_PER_SLOT=3
```
