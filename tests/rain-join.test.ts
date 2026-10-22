import { describe, expect, it } from "vitest";
import {
  buildRainJoinExhaustedReason,
  classifyRainJoinFailure,
  isPermanentRainJoinFailure,
  isRetryableRainFailure,
  isWagerRejection,
  limboResultHasOutcome,
  matchesJoinReqId,
  parseLimboResult,
  parseRain,
  rainCaptchaPrewarmWindow,
  rainJoinWindowOpen,
} from "../src/automation/rain-join.js";
import { shouldInvalidateRainCaptcha } from "../src/automation/rain-captcha.js";
import type { RainState } from "../src/rorush/types.js";

describe("isRetryableRainFailure", () => {
  it("treats captcha again as retryable and invalidating", () => {
    expect(isRetryableRainFailure("Please complete the CAPTCHA again and retry.")).toBe(true);
    expect(shouldInvalidateRainCaptcha("Please complete the CAPTCHA again and retry.")).toBe(true);
  });

  it("treats network and timeout as retryable", () => {
    expect(isRetryableRainFailure("fetch failed")).toBe(true);
    expect(isRetryableRainFailure("Rain join timed out")).toBe(true);
    expect(isRetryableRainFailure("Captcha invalid")).toBe(true);
    expect(isRetryableRainFailure("Something went wrong")).toBe(true);
  });
});

describe("isPermanentRainJoinFailure", () => {
  it("blocks only hard skips", () => {
    expect(isPermanentRainJoinFailure("Rain amount 10 below filter")).toBe(true);
    expect(isPermanentRainJoinFailure("Join rain disabled for account")).toBe(true);
    expect(isPermanentRainJoinFailure("Manual wager clear required — auto limbo turned off")).toBe(true);
    expect(isPermanentRainJoinFailure("Rain join failed")).toBe(false);
  });
});

describe("isWagerRejection", () => {
  it("detects wager-related failures", () => {
    expect(isWagerRejection("You need to wager 100 more coins")).toBe(true);
    expect(isWagerRejection("Play through requirement not met")).toBe(true);
    expect(isWagerRejection("Captcha invalid")).toBe(false);
  });
});

describe("buildRainJoinExhaustedReason", () => {
  it("explains captcha timeout when no token was used", () => {
    const msg = buildRainJoinExhaustedReason({
      lastReason: "Could not join this rain",
      joinSubmissions: 0,
      captchaTokenEverHeld: false,
    });
    expect(msg.toLowerCase()).toContain("captcha");
    expect(classifyRainJoinFailure(msg)).toBe("captcha");
  });

  it("explains captcha rejection after join was sent", () => {
    const msg = buildRainJoinExhaustedReason({
      lastReason: "Could not join this rain",
      joinSubmissions: 2,
      captchaTokenEverHeld: true,
    });
    expect(msg.toLowerCase()).toContain("submitting captcha");
    expect(classifyRainJoinFailure(msg)).toBe("captcha");
  });
});

describe("classifyRainJoinFailure", () => {
  it("labels captcha when no limbo was tried", () => {
    expect(classifyRainJoinFailure("Please complete the CAPTCHA again and retry.")).toBe("captcha");
  });

  it("labels wager after limbo even if site says captcha", () => {
    expect(
      classifyRainJoinFailure("Please complete the CAPTCHA again and retry.", {
        wagerClearAttempted: true,
      }),
    ).toBe("wager_after_limbo");
  });

  it("labels wager when RoRush message mentions wager", () => {
    expect(classifyRainJoinFailure("You must wager before joining")).toBe("wager");
  });

  it("labels funcoin before captcha when RoRush says permission denied", () => {
    expect(classifyRainJoinFailure("Permission denied")).toBe("funcoin");
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
  it("prewarms shortly before join opens, not early tip stage", () => {
    const rain: RainState = {
      rainId: "1",
      createdTimestamp: 1_000,
      tipStageDuration: 600_000,
      joinStageDuration: 2_000,
    };
    expect(rainJoinWindowOpen(rain, 1_200)).toBe(false);
    expect(rainCaptchaPrewarmWindow(rain, 1_200)).toBe(false);
    expect(rainCaptchaPrewarmWindow(rain, 600_500)).toBe(true);
  });

  it("does not prewarm during long tip stage far from join", () => {
    const rain: RainState = {
      rainId: "1",
      createdTimestamp: 0,
      tipStageDuration: 600_000,
      joinStageDuration: 90_000,
    };
    expect(rainCaptchaPrewarmWindow(rain, 60_000)).toBe(false);
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

describe("parseLimboResult", () => {
  it("parses cent-style multiplier and IsWin", () => {
    const r = parseLimboResult({ IsWin: false, Multiplier: 112 }, 1.3);
    expect(r.crashMultiplier).toBe(1.12);
    expect(r.hit).toBe(false);
  });

  it("parses nested result object", () => {
    const r = parseLimboResult({ result: { multiplier: 2.45 }, isWin: true }, 1.3);
    expect(r.crashMultiplier).toBe(2.45);
    expect(r.hit).toBe(true);
  });

  it("infers hit from crash vs target when isWin missing", () => {
    const r = parseLimboResult({ multiplier: 1.5 }, 1.3);
    expect(r.hit).toBe(true);
    expect(r.crashMultiplier).toBe(1.5);
  });
});

describe("limboResultHasOutcome", () => {
  it("rejects bare reqId ack strings", () => {
    expect(limboResultHasOutcome("a5624ad8-96f1-4418-b0fc-bba89f5b6d53")).toBe(false);
  });

  it("accepts full outcome payloads", () => {
    expect(limboResultHasOutcome({ reqId: "x", multiplier: 1.2, isWin: false })).toBe(true);
  });
});
