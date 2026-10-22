import { describe, expect, it } from "vitest";
import {
  effectiveRainForTiming,
  rainCaptchaSolveWindow,
  rainJoinOpensInMs,
} from "../src/automation/rain-timing.js";

describe("effectiveRainForTiming", () => {
  it("assumes default tip when only createdTimestamp is known", () => {
    const created = Date.now() - 60_000;
    const rain = effectiveRainForTiming({
      rainId: "x",
      createdTimestamp: created,
    });
    expect(rain.tipStageDuration).toBe(300_000);
    expect(rainJoinOpensInMs(rain)).toBeGreaterThan(200_000);
  });

  it("enters solve window within lead before inferred join", () => {
    const joinStart = Date.now() + 100_000;
    const created = joinStart - 300_000;
    const rain = effectiveRainForTiming({
      rainId: "x",
      createdTimestamp: created,
      tipStageDuration: 300_000,
      joinStageDuration: 90_000,
    });
    expect(rainCaptchaSolveWindow(rain, joinStart - 110_000)).toBe(true);
  });
});
