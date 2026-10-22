import { afterEach, describe, expect, it, vi } from "vitest";

describe("refreshRainCaptchasForJoin", () => {
  afterEach(() => {
    vi.resetModules();
    vi.unstubAllEnvs();
  });

  it("does not start a second solve when a fresh cached token exists", async () => {
    vi.stubEnv("CAPTCHA_RAIN_MAX_TASKS_PER_SLOT", "5");
    const solve = vi.fn().mockResolvedValue("token-abc");
    vi.doMock("../src/captcha/solve.js", () => ({
      solveCaptcha: solve,
      isCaptchaRetryableTaskError: () => false,
      isTransientNetworkError: () => false,
    }));

    const mod = await import("../src/automation/rain-captcha.js");
    const rainId = "rain-test-fresh-token";
    mod.prewarmRainCaptchasParallel(rainId, [1]);
    await new Promise((r) => setTimeout(r, 50));
    const before = solve.mock.calls.length;
    mod.refreshRainCaptchasForJoin(rainId, [1]);
    await new Promise((r) => setTimeout(r, 30));
    expect(solve.mock.calls.length).toBe(before);
    mod.markRainCaptchaFinished(rainId);
  });
});
