import { describe, expect, it } from "vitest";
import {
  normalizeDailyCasesInfoBody,
  normalizeRewardCaseEntry,
} from "../src/automation/reward-cases.js";

describe("reward case info parsing", () => {
  it("unwraps data envelope", () => {
    expect(
      normalizeDailyCasesInfoBody({
        data: { dailyCase: { caseId: "abc", isAvailable: true } },
      }).dailyCase,
    ).toEqual({ caseId: "abc", isAvailable: true });
  });

  it("reads nested case object", () => {
    const entry = normalizeRewardCaseEntry({
      isAvailable: true,
      case: { caseId: "x", caseName: "Level 50", rankId: "rank-1" },
    });
    expect(entry?.caseId).toBe("x");
    expect(entry?.caseName).toBe("Level 50");
    expect(entry?.rankId).toBe("rank-1");
  });
});
