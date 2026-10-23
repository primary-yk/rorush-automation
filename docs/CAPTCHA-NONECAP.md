# Rush Pilot ↔ NoneCap (hCaptcha for RoRush rain)

RoRush rain joins require **hCaptcha**. This project uses **[NoneCap](https://nonecap.com)** by default.

## `.env`

```bash
CAPTCHA_API_KEY=nc_live_xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx
CAPTCHA_PROVIDER=nonecap
RORUSH_SITE_URL=https://rorush.com/
```

Get a key from the NoneCap dashboard (`nc_live_…` prefix). Balance is in **credits** (`GET /v1/me`); the host dashboard estimates USD using `CAPTCHA_ESTIMATE_USD`.

## Verify

```bash
npm run test-captcha
```

## Other providers

Set `CAPTCHA_PROVIDER=2captcha` or `capsolver` with the matching API key. See `docs/CAPTCHA-2CAPTCHA.md` for 2Captcha tuning env vars (poll, cancel, rain dual-start).
