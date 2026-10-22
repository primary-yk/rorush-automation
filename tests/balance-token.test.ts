import { describe, expect, it } from "vitest";
import { isFunCoinRainBlock, parseCurrentBalanceToken } from "../src/rorush/balance-token.js";

describe("parseCurrentBalanceToken", () => {
  it("reads token from auth/session shapes", () => {
    expect(parseCurrentBalanceToken({ currentBalanceToken: "coin" })).toBe("coin");
    expect(parseCurrentBalanceToken({ currentBalanceToken: "funCoin" })).toBe("funCoin");
    expect(parseCurrentBalanceToken({ userInfo: { currentBalanceToken: "funCoin" } })).toBe("funCoin");
    expect(parseCurrentBalanceToken({ data: { balanceToken: "coin" } })).toBe("coin");
  });
});

describe("isFunCoinRainBlock", () => {
  it("detects permission denied and fun coin copy", () => {
    expect(isFunCoinRainBlock("Permission denied")).toBe(true);
    expect(isFunCoinRainBlock("Switch to real coins to join rain")).toBe(true);
    expect(isFunCoinRainBlock("Captcha invalid")).toBe(false);
  });
});

describe("switchFromFunCoinsIfNeeded (via parse)", () => {
  it("only funCoin token should trigger a switch decision", () => {
    expect(parseCurrentBalanceToken({ currentBalanceToken: "coin" })).toBe("coin");
    expect(parseCurrentBalanceToken({ currentBalanceToken: "funCoin" })).toBe("funCoin");
    expect(parseCurrentBalanceToken({ authenticated: true })).toBeNull();
  });
});
