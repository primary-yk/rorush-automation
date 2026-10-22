import { describe, expect, it } from "vitest";
import {
  isFunCoinRainBlock,
  parseCurrentBalanceToken,
  shouldCorrectFunCoinWallet,
} from "../src/rorush/balance-token.js";

describe("parseCurrentBalanceToken", () => {
  it("reads token from auth/session shapes", () => {
    expect(parseCurrentBalanceToken({ currentBalanceToken: "coin" })).toBe("coin");
    expect(parseCurrentBalanceToken({ currentBalanceToken: "funCoin" })).toBe("funCoin");
    expect(parseCurrentBalanceToken({ userInfo: { currentBalanceToken: "funCoin" } })).toBe("funCoin");
    expect(parseCurrentBalanceToken({ data: { balanceToken: "coin" } })).toBe("coin");
  });
});

describe("shouldCorrectFunCoinWallet", () => {
  it("switches only on funCoin for detected/periodic", () => {
    expect(shouldCorrectFunCoinWallet("coin", "detected")).toBe(false);
    expect(shouldCorrectFunCoinWallet("funCoin", "detected")).toBe(true);
    expect(shouldCorrectFunCoinWallet(null, "detected")).toBe(false);
    expect(shouldCorrectFunCoinWallet("funCoin", "periodic")).toBe(true);
  });

  it("permission denied may switch when token unknown", () => {
    expect(shouldCorrectFunCoinWallet(null, "permission_denied")).toBe(true);
    expect(shouldCorrectFunCoinWallet("coin", "permission_denied")).toBe(false);
    expect(shouldCorrectFunCoinWallet("funCoin", "permission_denied")).toBe(true);
  });
});

describe("isFunCoinRainBlock", () => {
  it("detects permission denied and fun coin copy", () => {
    expect(isFunCoinRainBlock("Permission denied")).toBe(true);
    expect(isFunCoinRainBlock("Switch to real coins to join rain")).toBe(true);
    expect(isFunCoinRainBlock("Captcha invalid")).toBe(false);
  });
});
