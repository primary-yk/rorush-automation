import { describe, expect, it, vi } from "vitest";
import {
  normalizeDurationMs,
  normalizeEpochMs,
  rainCaptchaCancelAfterMs,
  rainCaptchaPrewarmWindow,
  rainCaptchaSolveWindow,
  rainJoinPrepShouldRun,
  rainJoinStageBounds,
} from "../src/automation/rain-timing.js";
import type { RainState } from "../src/rorush/types.js";

describe("normalizeEpochMs", () => {
  it("converts unix seconds to ms", () => {
    expect(normalizeEpochMs(1_762_000_000)).toBe(1_762_000_000_000);
  });
  it("leaves small test timestamps as ms", () => {
    expect(normalizeEpochMs(1_000_000)).toBe(1_000_000);
  });
  it("keeps ms", () => {
    expect(normalizeEpochMs(1_762_000_000_000)).toBe(1_762_000_000_000);
  });
});

describe("normalizeDurationMs", () => {
  it("treats 90 as seconds", () => {
    expect(normalizeDurationMs(90)).toBe(90_000);
  });
});

describe("rainCaptchaSolveWindow", () => {
  it("opens within configured lead before join", () => {
    vi.stubEnv("CAPTCHA_SOLVE_START_LEAD_MS", "120000");
    const joinStart = 1_000_000;
    const rain: RainState = {
      rainId: "x",
      joinStageStartTimestamp: joinStart,
      joinStageDuration: 90_000,
    };
    expect(rainCaptchaSolveWindow(rain, joinStart - 121_000)).toBe(false);
    expect(rainCaptchaSolveWindow(rain, joinStart - 119_000)).toBe(true);
    vi.unstubAllEnvs();
  });

  it("prep tick runs during solve window even if hub prewarm env is narrower", () => {
    const joinStart = 500_000;
    const rain: RainState = {
      rainId: "x",
      createdTimestamp: joinStart - 180_000,
      tipStageDuration: 180_000,
      joinStageDuration: 90_000,
    };
    const now = joinStart - 100_000;
    vi.stubEnv("RAIN_CAPTCHA_PREWARM_BEFORE_JOIN_MS", "60000");
    expect(rainCaptchaPrewarmWindow(rain, now)).toBe(false);
    expect(rainCaptchaSolveWindow(rain, now)).toBe(true);
    expect(rainJoinPrepShouldRun(rain, now)).toBe(true);
    vi.unstubAllEnvs();
  });
});

describe("rainCaptchaCancelAfterMs", () => {
  it("auto budget spans tip lead through most of join window", () => {
    const joinStart = 100_000;
    const rain: RainState = {
      rainId: "x",
      joinStageStartTimestamp: joinStart,
      joinStageDuration: 90_000,
    };
    const now = joinStart - 60_000;
    const cancel = rainCaptchaCancelAfterMs(rain, now);
    expect(cancel).toBeGreaterThanOrEqual(60_000 + 90_000 - 12_000 - 5000);
    expect(rainJoinStageBounds(rain, now)?.joinStart).toBe(joinStart);
  });
});
