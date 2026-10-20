import { describe, expect, it } from "vitest";
import { isCaptchaRetryableTaskError } from "../src/captcha/solve.js";

describe("isCaptchaRetryableTaskError", () => {
  it("matches worker unsolvable and timeouts", () => {
    expect(isCaptchaRetryableTaskError(new Error("Workers could not solve the Captcha"))).toBe(true);
    expect(isCaptchaRetryableTaskError(new Error("Captcha solve timed out after ~218s"))).toBe(true);
    expect(isCaptchaRetryableTaskError(new Error("Captcha processing stall ~110s — task cancelled"))).toBe(
      true,
    );
  });

  it("does not match bad API key", () => {
    expect(isCaptchaRetryableTaskError(new Error("ERROR_KEY_DOES_NOT_EXIST"))).toBe(false);
  });
});
