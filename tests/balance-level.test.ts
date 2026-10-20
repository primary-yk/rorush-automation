import { describe, expect, it } from "vitest";
import { parseBalanceCents, parseLevel } from "../src/rorush/balance-level.js";

describe("parseBalanceCents", () => {
  it("reads bare numeric body (RoRush ?currency=crypto)", () => {
    expect(parseBalanceCents(12_345)).toBe(12_345);
    expect(parseBalanceCents("99.5")).toBe(99.5);
  });

  it("reads wrapped and object shapes", () => {
    expect(parseBalanceCents({ data: 500 })).toBe(500);
    expect(parseBalanceCents({ cryptoBalance: 1000 })).toBe(1000);
  });
});

describe("parseLevel", () => {
  it("reads currentLevel from levelInfo", () => {
    expect(parseLevel({ currentLevel: 93, totalWagered: 1 })).toBe(93);
    expect(parseLevel({ data: { currentLevel: 42 } })).toBe(42);
  });

  it("reads legacy level fields", () => {
    expect(parseLevel({ level: 10 })).toBe(10);
    expect(parseLevel({ userInfo: { level: 7 } })).toBe(7);
  });
});
