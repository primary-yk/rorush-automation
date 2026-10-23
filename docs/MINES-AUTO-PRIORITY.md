# Mines auto (priority)

**Goal:** After each joined rain, bet **100% of that rain’s profit** on RoRush Mines once, then cash out at a target multiplier and **deposit winnings to vault**.

## Discord

| Command | Purpose |
|---------|---------|
| `/mines auto` | Turn on: mine count, target multiplier, random tiles yes/no, **wallet** (real / FunCoins), stop after N rains |
| `/mines stop` | Turn off mines auto for an account |
| `/mines status` | Show remaining rain rounds and settings |
| `/mines test` | One test round (pick **real** or **FunCoins** wallet; no vault) |

**Wallet:** `wallet:real` (default) uses **real coins** and vaults cashout profit. `wallet:funcoins` uses **FunCoins** on RoRush (good for testing); winnings are **not** sent to vault.

**Manual board (random = no):** 5×5 button grid in the user’s **private feed thread** — it appears **when a rain payout triggers mines**, not in the `/mines auto` reply. Enabling manual mode posts an “armed” note in the thread. Use **`/mines test`** with **random: No** to try the board immediately. Click tiles to reveal; bot syncs to RoRush. Cashout at target → vault (real coins only).

**Random = yes:** Bot picks random unrevealed tiles until target multiplier or bomb.

## Account example

Works for any linked account (e.g. **fiery**). Owner must run **`/connect`** so the board can post to their thread.

## Rain counter

`stop_after_rains: 5` → mines runs on the next **5** rain payouts, then auto turns off.

## vs Limbo

When **mines auto** is on for an account, post-rain **limbo wager is skipped** for that rain (mines uses the rain profit instead).
