import { describe, expect, it } from "vitest";
import {
  normalizeEpochMs,
  rainCaptchaCancelAfterMs,
  rainCaptchaSolveWindow,
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

describe("rainCaptchaSolveWindow", () => {
  it("opens within default 120s lead before join", () => {
    const joinStart = 1_000_000;
    const rain: RainState = {
      rainId: "x",
      joinStageStartTimestamp: joinStart,
      joinStageDuration: 90_000,
    };
    expect(rainCaptchaSolveWindow(rain, joinStart - 130_000)).toBe(false);
    expect(rainCaptchaSolveWindow(rain, joinStart - 110_000)).toBe(true);
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
