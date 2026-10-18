export class GiveUpError extends Error {
  constructor(
    message: string,
    public readonly attempts: number,
  ) {
    super(message);
    this.name = "GiveUpError";
  }
}

export async function withBackoff<T>(
  fn: () => Promise<T>,
  options: {
    maxAttempts: number;
    baseDelayMs?: number;
    shouldRetry?: (err: unknown, attempt: number) => boolean;
  },
): Promise<T> {
  const base = options.baseDelayMs ?? 500;
  let lastErr: unknown;
  for (let attempt = 1; attempt <= options.maxAttempts; attempt++) {
    try {
      return await fn();
    } catch (err) {
      lastErr = err;
      const retry =
        attempt < options.maxAttempts &&
        (options.shouldRetry?.(err, attempt) ?? true);
      if (!retry) break;
      const delay = base * 2 ** (attempt - 1);
      await new Promise((r) => setTimeout(r, delay));
    }
  }
  throw new GiveUpError(
    lastErr instanceof Error ? lastErr.message : String(lastErr),
    options.maxAttempts,
  );
}
