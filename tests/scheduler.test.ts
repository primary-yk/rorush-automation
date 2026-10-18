import { describe, expect, it } from "vitest";
import { extractCodesFromText } from "../src/discord/watcher.js";
import { msUntilNextCaseUnlock } from "../src/automation/case-scheduler.js";

describe("extractCodesFromText", () => {
  it("finds promo codes and level hints", () => {
    const codes = extractCodesFromText("New flash code RUSH-500 for level 10 users");
    expect(codes.some((c) => c.code === "RUSH-500")).toBe(true);
    expect(codes.find((c) => c.code === "RUSH-500")?.minLevel).toBe(10);
  });
});

describe("msUntilNextCaseUnlock", () => {
  it("returns a positive delay when no schedule exists", () => {
    expect(msUntilNextCaseUnlock()).toBeGreaterThan(0);
  });
});
