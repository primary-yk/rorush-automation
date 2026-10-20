import { describe, expect, it } from "vitest";
import {
  clearActivityDedupeForRain,
  shouldSkipDuplicateActivityLog,
} from "../src/db/activity-dedupe.js";

describe("activity dedupe", () => {
  it("drops duplicate global rain lines within window", () => {
    const rainId = "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee";
    const row = {
      category: "rain",
      message: "Rain created",
      detail: `${rainId} · pool 100 coins`,
    };
    expect(shouldSkipDuplicateActivityLog(row)).toBe(false);
    expect(shouldSkipDuplicateActivityLog(row)).toBe(true);
    clearActivityDedupeForRain(rainId);
    expect(shouldSkipDuplicateActivityLog(row)).toBe(false);
  });
});
