import { appendLog, getAccount, updateAccount } from "../db/repositories.js";
import type { RoRushHttpClient } from "../rorush/http-client.js";
import type { HubRegistry } from "../worker/hub-registry.js";
import { startMinesRoundOnHub } from "./mines-round.js";
import {
  closeManualMinesSession,
  createManualMinesSession,
} from "./mines-manual-session.js";
import { postMinesBoardToOwner } from "../discord/mines-board.js";
import { deliverFriendsReporterEmbed } from "../discord/friends-feed.js";
import { COLORS } from "../discord/embeds.js";

export function minesAutoActive(account: {
  mines_auto_enabled: number;
  mines_auto_rains_remaining: number;
}): boolean {
  if (Number(account.mines_auto_enabled) === 0) return false;
  const left = account.mines_auto_rains_remaining;
  if (left === 0) return false;
  return true;
}

function decrementRainsRemaining(accountId: number): void {
  const row = getAccount(accountId);
  if (!row || Number(row.mines_auto_enabled) === 0) return;
  const left = row.mines_auto_rains_remaining;
  if (left < 0) return;
  if (left === 0) return;
  const next = left - 1;
  updateAccount(accountId, {
    mines_auto_rains_remaining: next,
    ...(next === 0 ? { mines_auto_enabled: 0 } : {}),
  });
  if (next === 0) {
    appendLog({
      accountId,
      category: "mines",
      message: "Mines auto stopped",
      detail: "Rain limit reached",
    });
  }
}

/** Bet full rain profit on mines once (random or manual board). */
export async function runMinesAfterRain(input: {
  accountId: number;
  rainId: string;
  rainProfitCoins: number;
  client: RoRushHttpClient;
  hubs: HubRegistry;
}): Promise<void> {
  const account = getAccount(input.accountId);
  if (!account || !minesAutoActive(account)) return;

  const hub = await input.hubs.ensure(input.accountId, { rain: true, cases: true });
  const config = {
    accountId: account.id,
    nickname: account.nickname,
    betCoins: Math.floor(input.rainProfitCoins * 100) / 100,
    minesCount: Math.trunc(account.mines_count),
    targetMultiplier: account.mines_target_multiplier,
    randomTiles: Number(account.mines_random_tiles) !== 0,
    rainId: input.rainId,
    vaultAfterCashout: true,
  };

  if (config.randomTiles) {
    const outcome = await startMinesRoundOnHub({ hub, client: input.client, config });
    decrementRainsRemaining(account.id);
    void deliverFriendsReporterEmbed(
      {
        title: outcome.ok ? (outcome.hit ? "Mines · Cashed out" : "Mines · Bomb") : "Mines · Failed",
        description: outcome.ok
          ? `${account.nickname} · ${config.betCoins.toFixed(2)} coins · ${outcome.multiplier.toFixed(2)}×` +
            (outcome.vaultedCoins != null ? ` · vaulted **${outcome.vaultedCoins.toFixed(2)}**` : "")
          : outcome.reason,
        color: outcome.ok && outcome.hit ? COLORS.limboHit : outcome.ok ? COLORS.limboMiss : COLORS.limboSkip,
      },
      { accountId: account.id, nickname: account.nickname },
    );
    return;
  }

  const session = createManualMinesSession({
    accountId: account.id,
    config,
    hub,
    client: input.client,
    gameStarted: false,
  });

  const posted = await postMinesBoardToOwner({
    ownerDiscordId: account.owner_discord_id,
    accountId: account.id,
    nickname: account.nickname,
    betCoins: config.betCoins,
    minesCount: config.minesCount,
    targetMultiplier: config.targetMultiplier,
    revealed: session.revealed,
    status: "Click a tile to reveal (rain profit is your bet).",
  });

  if (!posted) {
    closeManualMinesSession(account.id);
    appendLog({
      accountId: account.id,
      category: "mines",
      message: "Mines manual skipped",
      detail: "No feed thread — run /connect",
    });
    decrementRainsRemaining(account.id);
    return;
  }

  void (async () => {
    try {
      const outcome = await startMinesRoundOnHub({
        hub,
        client: input.client,
        config,
        pickTile: async (revealed) => {
          while (!session.closed) {
            const tile = await session.waitForTile();
            if (tile < 0 || tile >= 25) return null;
            if (!revealed.has(tile)) return tile;
          }
          return null;
        },
      });
      decrementRainsRemaining(account.id);
      closeManualMinesSession(account.id);
      void deliverFriendsReporterEmbed(
        {
          title: outcome.ok ? (outcome.hit ? "Mines · Cashed out" : "Mines · Bomb") : "Mines · Failed",
          description: outcome.ok
            ? `${account.nickname} · ${outcome.multiplier.toFixed(2)}×` +
              (outcome.vaultedCoins != null ? ` · vaulted **${outcome.vaultedCoins.toFixed(2)}**` : "")
            : outcome.reason,
          color: outcome.ok && outcome.hit ? COLORS.limboHit : outcome.ok ? COLORS.limboMiss : COLORS.limboSkip,
        },
        { accountId: account.id, nickname: account.nickname },
      );
    } catch (err) {
      closeManualMinesSession(account.id);
      const msg = err instanceof Error ? err.message : String(err);
      appendLog({ accountId: account.id, category: "mines", message: "Manual mines error", detail: msg });
    }
  })();
}
