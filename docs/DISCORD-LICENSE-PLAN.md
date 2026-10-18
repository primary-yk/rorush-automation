# Discord + license overview

**Primary path:** vendor-hosted **Discord bot** — see [DISCORD-BOT.md](./DISCORD-BOT.md).

**Secondary path:** web dashboard at `http://127.0.0.1:43123` — same engine.

**Optional fallback:** thread webhook in Settings (if someone cannot use the bot relay).

## License

- Keys: `npx tsx scripts/issue-license.ts --id customer --days 365`
- Optional: `--discord-user ID` so only that Discord user can `/activate` that key.
- Customer stores key via dashboard activation; relay uses the same key to authenticate to your bot.
