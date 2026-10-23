import { parseMinesWalletMode, minesWalletLabel, type MinesWalletMode } from "../automation/mines-currency.js";
import { getAccount, listAccounts, updateAccount, type AccountRow } from "../db/repositories.js";
import { engine } from "../worker/engine.js";
import { ownerHasFeedThread, postMinesManualArmedNotice } from "./mines-board.js";
import { appendSessionHintIfNeeded } from "./friends-auth-hints.js";
import { looksLikeAuthError } from "../accounts/session-manager.js";

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

  const walletLabel = minesWalletLabel(input.walletMode);
  let manualLine = "";
  if (!input.randomTiles) {
    const hasThread = ownerHasFeedThread(account.owner_discord_id);
    if (hasThread) {
      const posted = await postMinesManualArmedNotice({
        ownerDiscordId: account.owner_discord_id,
        nickname: account.nickname,
        minesCount,
        targetMultiplier: target,
        rainsRemaining: rains,
        walletLabel,
      });
      manualLine = posted
        ? "Manual tiles: check your **private feed thread** — armed message posted; the **5×5 board** appears when the **next rain** pays profit."
        : "Manual tiles: run **`/connect`**, then **`/mines auto`** again — the board posts in your feed thread **after the next rain** (not here).";
    } else {
      manualLine =
        "Manual tiles: run **`/connect`** first. The **5×5 board** only appears in your feed thread **after a rain** pays profit (not when you run this command).";
    }
  }

  const mode = input.randomTiles
    ? "random tiles each rain"
    : manualLine || "manual board after each rain";
  const vaultLine =
    input.walletMode === "coin"
      ? "cashout at **{target}×** → **vault**"
      : "cashout at **{target}×** (FunCoins — **not** vaulted)";
  return (
    `**${account.nickname}** · Mines auto **ON** for **${rains}** rain(s).\n` +
    `Wallet: **${walletLabel}** · each rain profit → mines · **${minesCount}** mines · ${vaultLine.replace("{target}", target.toFixed(2))} · ${mode}.\n` +
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

  let result;
  try {
    result = await engine.testMines({
      accountId: account.id,
      betCoins: input.betCoins,
      minesCount,
      targetMultiplier: target,
      randomTiles: input.randomTiles,
      walletMode: input.walletMode,
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    if (looksLikeAuthError(msg)) {
      const lead = account.password_enc?.trim()
        ? `**${account.nickname}** · RoRush rejected the login (**${msg}**).`
        : `**${account.nickname}** · RoRush rejected the session (**${msg}**).`;
      return appendSessionHintIfNeeded(lead, account);
    }
    throw err;
  }

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
