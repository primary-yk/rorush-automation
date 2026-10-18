# License keys (vendor only)

Rush Pilot uses **Ed25519-signed** license strings. Customers paste a key in the dashboard; your **private signing key never ships** with the app.

## One-time key setup

On your machine only:

```bash
npx tsx scripts/license-keygen.ts
```

- Put **`LICENSE_PUBLIC_KEY`** in `.env.example` / production builds you distribute.
- Keep **`LICENSE_PRIVATE_KEY`** in a local `.env` file that is **not** committed or sent to customers.

## Issue a customer key

```bash
# .env contains LICENSE_PRIVATE_KEY=...
npx tsx scripts/issue-license.ts --id customer-alias --days 365 --plan standard

# Optional: embed customer's Discord user id for your support bot / private threads
npx tsx scripts/issue-license.ts --id customer-alias --days 365 --discord-user 123456789012345678
```

Copy the printed `RP1.…` key into your sale email.

## Your own dev machine

In `.env` (never ship this to paying users):

```env
LICENSE_DEV_SKIP=true
```

Skips license checks while you develop. Remove or set `false` before you test the real activation flow.

## Security notes

- Keys are verified offline; determined users can patch binaries. Treat licenses as honest-customer enforcement, not DRM.
- For stricter control later, add an online activation API and heartbeat — the dashboard already gates automation on `isLicenseActive()`.
