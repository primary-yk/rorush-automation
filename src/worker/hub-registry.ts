import { ensureAuthenticated } from "../accounts/session-manager.js";
import { RoRushHub } from "../rorush/signalr-hub.js";

/** Per-account SignalR hubs shared by rain join and case opening. */
export class HubRegistry {
  private readonly hubs = new Map<number, RoRushHub>();

  get(accountId: number): RoRushHub | undefined {
    return this.hubs.get(accountId);
  }

  entries(): IterableIterator<[number, RoRushHub]> {
    return this.hubs.entries();
  }

  values(): IterableIterator<RoRushHub> {
    return this.hubs.values();
  }

  async ensure(accountId: number, opts: { rain?: boolean; cases?: boolean }): Promise<RoRushHub> {
    const { creds, account } = await ensureAuthenticated(accountId);
    let hub = this.hubs.get(accountId);
    if (!hub) {
      hub = new RoRushHub(creds, {}, account.proxy_url);
      this.hubs.set(accountId, hub);
    }
    if (!hub.isConnected()) await hub.connect();
    if (opts.rain) await hub.ensureRainSubscribed();
    if (opts.cases) await hub.ensureCaseSubscribed();
    return hub;
  }

  async disconnectAll(): Promise<void> {
    for (const hub of this.hubs.values()) {
      await hub.disconnect();
    }
    this.hubs.clear();
  }

  async disconnect(accountId: number): Promise<void> {
    const hub = this.hubs.get(accountId);
    if (!hub) return;
    await hub.disconnect();
    this.hubs.delete(accountId);
  }

  asMap(): Map<number, RoRushHub> {
    return this.hubs;
  }
}
