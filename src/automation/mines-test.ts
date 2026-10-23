import { ensureAuthenticated } from "../accounts/session-manager.js";
import { applyMinesWalletMode, minesWalletLabel, type MinesWalletMode } from "./mines-currency.js";
import { parseBalanceCents } from "../rorush/balance-level.js";
import type { HubRegistry } from "../worker/hub-registry.js";
import {
  closeManualMinesSession,
  createManualMinesSession,
} from "./mines-manual-session.js";
import { startMinesRoundOnHub, type MinesRoundOutcome } from "./mines-round.js";
import { postMinesBoardToOwner } from "../discord/mines-board.js";
import { deliverFriendsReporterEmbed } from "../discord/friends-feed.js";
import { COLORS } from "../discord/embeds.js";
import { getAccount } from "../db/repositories.js";

export type MinesTestResult =
  | { mode: "done"; outcome: MinesRoundOutcome; betCoins: number }
  | { mode: "manual_started"; betCoins: number };

export async function runTestMinesRound(input: {
  accountId: number;
  betCoins: number;
  minesCount: number;
  targetMultiplier: number;
  randomTiles: boolean;
  walletMode: MinesWalletMode;
  hubs: HubRegistry;
}): Promise<MinesTestResult> {
  const account = getAccount(input.accountId);
  if (!account) {
    return { mode: "done", outcome: { ok: false, reason: "Account not found" }, betCoins: 0 };
  }

  const { client } = await ensureAuthenticated(input.accountId);
  await applyMinesWalletMode(client, input.walletMode);
  const balBody = await client.getBalance("crypto");
  const balCents = parseBalanceCents(balBody);
  const walletCoins = balCents != null ? balCents / 100 : 0;
  const betCoins = Math.min(
    Math.floor(input.betCoins * 100) / 100,
    Math.floor(walletCoins * 100) / 100,
  );
  if (betCoins < 0.01) {
    return {
      mode: "done",
      outcome: {
        ok: false,
        reason: `${minesWalletLabel(input.walletMode)} balance too low (${walletCoins.toFixed(2)} coins)`,
      },
      betCoins: 0,
    };
  }

  const hub = await input.hubs.ensure(input.accountId, { rain: true, cases: true });
  const config = {
    accountId: account.id,
    nickname: account.nickname,
    betCoins,
    minesCount: input.minesCount,
    targetMultiplier: input.targetMultiplier,
    randomTiles: input.randomTiles,
    rainId: "test-mines",
    vaultAfterCashout: false,
    walletMode: input.walletMode,
  };

  if (input.randomTiles) {
    const outcome = await startMinesRoundOnHub({ hub, client, config });
    return { mode: "done", outcome, betCoins };
  }

  const session = createManualMinesSession({
    accountId: account.id,
    config,
    hub,
    client,
  });

  const posted = await postMinesBoardToOwner({
    ownerDiscordId: account.owner_discord_id,
    accountId: account.id,
    nickname: account.nickname,
    betCoins,
    minesCount: config.minesCount,
    targetMultiplier: config.targetMultiplier,
    revealed: session.revealed,
    status: `**Test mines** · ${minesWalletLabel(input.walletMode)} · click tiles (no vault on test).`,
  });

  if (!posted) {
    closeManualMinesSession(account.id);
    return {
      mode: "done",
      outcome: { ok: false, reason: "Could not post board — run **/connect** for your feed thread." },
      betCoins,
    };
  }

  void (async () => {
    try {
      const outcome = await startMinesRoundOnHub({
        hub,
        client,
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
      closeManualMinesSession(account.id);
      void deliverFriendsReporterEmbed(
        {
          title: outcome.ok ? (outcome.hit ? "Mines test · Cashed out" : "Mines test · Bomb") : "Mines test · Failed",
          description: outcome.ok
            ? `${account.nickname} · ${betCoins.toFixed(2)} ${minesWalletLabel(input.walletMode)} · ${outcome.multiplier.toFixed(2)}×`
            : outcome.reason,
          color: outcome.ok && outcome.hit ? COLORS.limboHit : outcome.ok ? COLORS.limboMiss : COLORS.limboSkip,
        },
        { accountId: account.id, nickname: account.nickname },
      );
    } catch (err) {
      closeManualMinesSession(account.id);
    }
  })();

  return { mode: "manual_started", betCoins };
}
