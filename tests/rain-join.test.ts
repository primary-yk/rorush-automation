import { describe, expect, it } from "vitest";
import { isWagerRejection, rainJoinWindowOpen } from "../src/automation/rain-join.js";
import type { RainState } from "../src/rorush/types.js";

describe("isWagerRejection", () => {
  it("detects wager-related failures", () => {
    expect(isWagerRejection("You need to wager 100 more coins")).toBe(true);
    expect(isWagerRejection("Play through requirement not met")).toBe(true);
    expect(isWagerRejection("Captcha invalid")).toBe(false);
  });
});

describe("rainJoinWindowOpen", () => {
  it("opens after tip stage ends", () => {
    const rain: RainState = {
      rainId: "1",
      createdTimestamp: 1_000,
      tipStageDuration: 500,
    };
    expect(rainJoinWindowOpen(rain, 1_500)).toBe(true);
    expect(rainJoinWindowOpen(rain, 1_400)).toBe(false);
  });

  it("stays closed when timing fields are missing", () => {
    expect(rainJoinWindowOpen({ rainId: "x" })).toBe(false);
  });

  it("respects explicit join stage window", () => {
    const rain: RainState = {
      rainId: "2",
      joinStageStartTimestamp: 10_000,
      joinStageDuration: 2_000,
    };
    expect(rainJoinWindowOpen(rain, 10_500)).toBe(true);
    expect(rainJoinWindowOpen(rain, 12_500)).toBe(false);
  });
});
