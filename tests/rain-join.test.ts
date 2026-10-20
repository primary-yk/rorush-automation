import { describe, expect, it } from "vitest";
import {
  isWagerRejection,
  matchesJoinReqId,
  parseRain,
  rainCaptchaPrewarmWindow,
  rainJoinWindowOpen,
} from "../src/automation/rain-join.js";
import type { RainState } from "../src/rorush/types.js";

describe("isWagerRejection", () => {
  it("detects wager-related failures", () => {
    expect(isWagerRejection("You need to wager 100 more coins")).toBe(true);
    expect(isWagerRejection("Play through requirement not met")).toBe(true);
    expect(isWagerRejection("Captcha invalid")).toBe(false);
  });
});

describe("rainJoinWindowOpen", () => {
  it("opens after tip stage ends with bounded join duration", () => {
    const rain: RainState = {
      rainId: "1",
      createdTimestamp: 1_000,
      tipStageDuration: 500,
      joinStageDuration: 2_000,
    };
    expect(rainJoinWindowOpen(rain, 1_500)).toBe(true);
    expect(rainJoinWindowOpen(rain, 1_400)).toBe(false);
    expect(rainJoinWindowOpen(rain, 3_600)).toBe(false);
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

describe("rainCaptchaPrewarmWindow", () => {
  it("includes tip stage before join opens", () => {
    const rain: RainState = {
      rainId: "1",
      createdTimestamp: 1_000,
      tipStageDuration: 500,
      joinStageDuration: 2_000,
    };
    expect(rainCaptchaPrewarmWindow(rain, 1_200)).toBe(true);
    expect(rainJoinWindowOpen(rain, 1_200)).toBe(false);
  });
});

describe("parseRain", () => {
  it("maps ReceiveRainCreated timestamp fields", () => {
    const rain = parseRain({
      rainId: "abc",
      baseAmount: 50_000, // cents
      tipStageDuration: 60_000,
      joinStageDuration: 90_000,
      timestamp: 1_000_000,
    });
    expect(rain?.createdTimestamp).toBe(1_000_000);
    expect(rain?.amount).toBe(500);
    expect(rain?.joinStageStartTimestamp).toBeNull();
  });

  it("maps ReceiveRainJoinStageStart timestamp to join window", () => {
    const rain = parseRain({
      rainId: "abc",
      totalAmount: 80_000,
      joinStageDuration: 90_000,
      timestamp: 2_000_000,
    });
    expect(rain?.joinStageStartTimestamp).toBe(2_000_000);
    expect(rain?.joinStageDuration).toBe(90_000);
    expect(rainJoinWindowOpen(rain!, 2_000_500)).toBe(true);
  });
});

describe("matchesJoinReqId", () => {
  it("accepts RoRush success payload (plain reqId string)", () => {
    expect(matchesJoinReqId("req-1", "req-1")).toBe(true);
    expect(matchesJoinReqId("req-2", "req-1")).toBe(false);
  });
});
