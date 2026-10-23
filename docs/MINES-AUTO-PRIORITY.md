# Mines auto (priority)

**Goal:** After each joined rain, bet **100% of that rain’s profit** on RoRush Mines once, then cash out at a target multiplier and **deposit winnings to vault**.

## Discord

| Command | Purpose |
|---------|---------|
| `/mines auto` | Turn on: mine count, target multiplier, random tiles yes/no, stop after N rains |
| `/mines stop` | Turn off mines auto for an account |
| `/mines status` | Show remaining rain rounds and settings |

**Manual board (random = no):** 5×5 button grid in the user’s private feed thread. Click tiles to reveal; bot syncs to RoRush. Cashout at target → vault.

**Random = yes:** Bot picks random unrevealed tiles until target multiplier or bomb.

## Account example

Works for any linked account (e.g. **fiery**). Owner must run **`/connect`** so the board can post to their thread.

## Rain counter

`stop_after_rains: 5` → mines runs on the next **5** rain payouts, then auto turns off.

## vs Limbo

When **mines auto** is on for an account, post-rain **limbo wager is skipped** for that rain (mines uses the rain profit instead).
