import { getAccount, listAccounts, updateAccount, type AccountRow } from "../db/repositories.js";
import { engine } from "../worker/engine.js";

function findOwnedAccount(discordUserId: string, nickname?: string): AccountRow | undefined {
  const owned = listAccounts().filter((a) => a.owner_discord_id === discordUserId);
  if (nickname?.trim()) {
    const q = nickname.trim().toLowerCase();
    return owned.find((a) => a.nickname.toLowerCase() === q);
  }
  return owned[0];
}

export async function setMinesAutoForUser(input: {
  discordUserId: string;
  nickname?: string;
  minesCount: number;
  targetMultiplier: number;
  randomTiles: boolean;
  stopAfterRains: number;
}): Promise<string> {
  const account = findOwnedAccount(input.discordUserId, input.nickname);
  if (!account) {
    return "No linked account found. Use **`/account add`** first (e.g. nickname **fiery**).";
  }
  const minesCount = Math.min(24, Math.max(1, Math.trunc(input.minesCount)));
  const target = Math.max(1.01, input.targetMultiplier);
  const rains = Math.trunc(input.stopAfterRains);
  if (rains < 1) {
    return "**stop_after_rains** must be at least **1** (e.g. 5 rains then auto-off).";
  }

  updateAccount(account.id, {
    mines_auto_enabled: 1,
    mines_count: minesCount,
    mines_target_multiplier: target,
    mines_random_tiles: input.randomTiles ? 1 : 0,
    mines_auto_rains_remaining: rains,
  });
  await engine.reloadAccounts();

  const mode = input.randomTiles ? "random tiles" : "**manual board** in your feed thread (run **`/connect`** if you have not)";
  return (
    `**${account.nickname}** · Mines auto **ON** for **${rains}** rain(s).\n` +
    `Each rain profit → mines · **${minesCount}** mines · cashout at **${target.toFixed(2)}×** → **vault** · ${mode}.\n` +
    "Post-rain limbo is **skipped** while this is on. Stop early with **`/mines stop`**."
  );
}

export function stopMinesAutoForUser(discordUserId: string, nickname?: string): string {
  const account = findOwnedAccount(discordUserId, nickname);
  if (!account) return "No linked account found.";
  updateAccount(account.id, {
    mines_auto_enabled: 0,
    mines_auto_rains_remaining: 0,
  });
  return `**${account.nickname}** · Mines auto **OFF**.`;
}

export function minesStatusForUser(discordUserId: string, nickname?: string): string {
  const account = findOwnedAccount(discordUserId, nickname);
  if (!account) return "No linked account found.";
  if (Number(account.mines_auto_enabled) === 0) {
    return `**${account.nickname}** · Mines auto **off**. Use **/mines auto** to enable.`;
  }
  const left = account.mines_auto_rains_remaining;
  const mode = Number(account.mines_random_tiles) !== 0 ? "random" : "manual board";
  return (
    `**${account.nickname}** · Mines auto **on** · **${left}** rain(s) left\n` +
    `${account.mines_count} mines · target **${account.mines_target_multiplier.toFixed(2)}×** · ${mode}`
  );
}
