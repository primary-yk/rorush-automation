# Rush Pilot ↔ 2Captcha (hCaptcha for RoRush rain)

Use this if support asks how you integrate.

## Answers to the usual support questions

| Question | Rush Pilot |
|----------|------------|
| **API v1 or v2?** | **API v2** — `POST https://api.2captcha.com/createTask` and `getTaskResult` |
| **Task type** | **`HCaptchaTaskProxyless`** (no proxy) |
| **Proxy?** | **No** — proxyless only |
| **Site key / page URL** | `websiteKey`: RoRush hCaptcha sitekey (env `RORUSH_HCAPTCHA_SITEKEY` or built-in default). `websiteURL`: `https://rorush.com/` (env `RORUSH_SITE_URL`) |
| **What “timeout” means here** | Usually **2Captcha stuck in `processing`** — we cancel after ~110s (`CAPTCHA_CANCEL_AFTER_MS`) and submit a **second task** (`CAPTCHA_TASK_ATTEMPTS=2`). Full poll exhaustion still possible on a very slow queue. Less often: **`fetch failed`** (WSL/network). RoRush join timeout is separate (60s waiting for SignalR after token is sent). |
| **Token age** | We cache one token per rain; at join, if cached token is **>90s old** we discard and solve again (`CAPTCHA_TOKEN_MAX_AGE_MS`). |

## Task JSON we send (v2)

```json
{
  "clientKey": "<CAPTCHA_API_KEY>",
  "task": {
    "type": "HCaptchaTaskProxyless",
    "websiteURL": "https://rorush.com/",
    "websiteKey": "<hcaptcha sitekey>",
    "fallbackToActualUA": true
  }
}
```

## Env tuning (slow queue)

```env
CAPTCHA_PROVIDER=2captcha
CAPTCHA_API_KEY=...
CAPTCHA_MAX_POLLS=160
CAPTCHA_POLL_MS=2000
CAPTCHA_VERBOSE=1
```

## Verify locally

```bash
npm run discover-captcha   # confirm sitekey still matches RoRush
npm run test-captcha       # one paid solve (~30–120s)
```

Successful run prints balance, then `OK — captcha solve works` (often 30–180s depending on queue).

Prewarm during rain **tip stage** (`npm run dev` running) so the token is ready before the join window — queue time does not speed up, but join does not wait at the last second.
