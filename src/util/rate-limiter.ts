export class RateLimiter {
  private nextAllowedAt = 0;

  constructor(private readonly minIntervalMs: number) {}

  async waitTurn(): Promise<void> {
    const now = Date.now();
    const wait = Math.max(0, this.nextAllowedAt - now);
    if (wait > 0) {
      await new Promise((r) => setTimeout(r, wait));
    }
    this.nextAllowedAt = Date.now() + this.minIntervalMs;
  }
}
