import type { RoRushHttpClient } from "../rorush/http-client.js";
import type { RoRushHub } from "../rorush/signalr-hub.js";
import type { MinesRoundConfig } from "./mines-round.js";

export type ManualMinesSession = {
  accountId: number;
  config: MinesRoundConfig;
  hub: RoRushHub;
  client: RoRushHttpClient;
  revealed: Set<number>;
  gameStarted: boolean;
  /** Resolves next tile index from user click. */
  waitForTile: () => Promise<number>;
  pushTile: (tile: number) => void;
  closed: boolean;
};

const sessions = new Map<number, ManualMinesSession>();

export function getManualMinesSession(accountId: number): ManualMinesSession | undefined {
  return sessions.get(accountId);
}

export function closeManualMinesSession(accountId: number): void {
  const s = sessions.get(accountId);
  if (s) {
    s.closed = true;
    s.pushTile(-1);
  }
  sessions.delete(accountId);
}

export function createManualMinesSession(
  input: Omit<ManualMinesSession, "waitForTile" | "pushTile" | "closed" | "gameStarted" | "revealed"> & {
    gameStarted?: boolean;
    revealed?: Set<number>;
  },
): ManualMinesSession {
  closeManualMinesSession(input.accountId);
  let resolver: ((tile: number) => void) | null = null;
  const queuedTiles: number[] = [];
  const session: ManualMinesSession = {
    ...input,
    revealed: input.revealed ?? new Set<number>(),
    gameStarted: input.gameStarted ?? false,
    closed: false,
    waitForTile: () =>
      new Promise((resolve) => {
        if (session.closed) {
          resolve(-1);
          return;
        }
        const queued = queuedTiles.shift();
        if (queued != null) {
          resolve(queued);
          return;
        }
        resolver = resolve;
      }),
    pushTile: (tile: number) => {
      if (resolver) {
        const r = resolver;
        resolver = null;
        r(tile);
        return;
      }
      queuedTiles.push(tile);
    },
  };
  sessions.set(input.accountId, session);
  return session;
}
