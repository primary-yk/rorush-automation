import { parseMinesWalletMode, minesWalletLabel, type MinesWalletMode } from "../automation/mines-currency.js";
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
  walletMode: MinesWalletMode;
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
    mines_wallet_mode: input.walletMode,
  });
  await engine.reloadAccounts();

  const mode = input.randomTiles ? "random tiles" : "**manual board** in your feed thread (run **`/connect`** if you have not)";
  const vaultLine =
    input.walletMode === "coin"
      ? "cashout at **{target}×** → **vault**"
      : "cashout at **{target}×** (FunCoins — **not** vaulted)";
  return (
    `**${account.nickname}** · Mines auto **ON** for **${rains}** rain(s).\n` +
    `Wallet: **${minesWalletLabel(input.walletMode)}** · each rain profit → mines · **${minesCount}** mines · ${vaultLine.replace("{target}", target.toFixed(2))} · ${mode}.\n` +
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

export async function testMinesForDiscordUser(input: {
  discordUserId: string;
  nickname: string;
  betCoins: number;
  minesCount: number;
  targetMultiplier: number;
  randomTiles: boolean;
  walletMode: MinesWalletMode;
}): Promise<string> {
  const account = findOwnedAccount(input.discordUserId, input.nickname);
  if (!account) return `No account **${input.nickname}** saved for you. Use **/account add**.`;

  const minesCount = Math.min(24, Math.max(1, Math.trunc(input.minesCount)));
  const target = Math.max(1.01, input.targetMultiplier);
  if (!Number.isFinite(input.betCoins) || input.betCoins < 0.01) {
    return "Mines test bet must be at least **0.01** coins.";
  }

  const result = await engine.testMines({
    accountId: account.id,
    betCoins: input.betCoins,
    minesCount,
    targetMultiplier: target,
    randomTiles: input.randomTiles,
    walletMode: input.walletMode,
  });

  const wallet = minesWalletLabel(input.walletMode);

  if (result.mode === "manual_started") {
    return (
      `**${account.nickname}** · Test mines started (**${wallet}** · **${result.betCoins.toFixed(2)}** coins).\n` +
      "Check your **private feed thread** for the 5×5 board. Results post there when the round finishes."
    );
  }

  const { outcome, betCoins } = result;
  if (!outcome.ok) {
    return `**${account.nickname}** · Mines test failed — ${outcome.reason}`;
  }
  const label = outcome.hit ? "Cashed out" : "Bomb";
  return (
    `**${account.nickname}** · Test mines **${label}** · **${wallet}** · **${betCoins.toFixed(2)}** coins · **${outcome.multiplier.toFixed(2)}×** (no vault on test)`
  );
}

export function minesStatusForUser(discordUserId: string, nickname?: string): string {
  const account = findOwnedAccount(discordUserId, nickname);
  if (!account) return "No linked account found.";
  if (Number(account.mines_auto_enabled) === 0) {
    return `**${account.nickname}** · Mines auto **off**. Use **/mines auto** to enable.`;
  }
  const left = account.mines_auto_rains_remaining;
  const mode = Number(account.mines_random_tiles) !== 0 ? "random" : "manual board";
  const wallet = minesWalletLabel(parseMinesWalletMode(account.mines_wallet_mode));
  return (
    `**${account.nickname}** · Mines auto **on** · **${left}** rain(s) left\n` +
    `${wallet} · ${account.mines_count} mines · target **${account.mines_target_multiplier.toFixed(2)}×** · ${mode}`
  );
}
