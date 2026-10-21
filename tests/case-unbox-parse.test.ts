import { describe, expect, it } from "vitest";
import { parseCaseUnboxingPayload } from "../src/rorush/case-unbox-parse.js";

describe("parseCaseUnboxingPayload", () => {
  it("matches reqId and parses roundResults", () => {
    const parsed = parseCaseUnboxingPayload(
      {
        reqId: "abc",
        result: {
          roundResults: [
            {
              winAmount: 250,
              itemName: "Gold Coin",
              imageUrl: "https://cdn.example/item.png",
            },
          ],
        },
      },
      "abc",
    );
    expect(parsed.matched).toBe(true);
    expect(parsed.totalWinCoins).toBe(2.5);
    expect(parsed.items[0]?.name).toBe("Gold Coin");
    expect(parsed.items[0]?.imageUrl).toContain("https://");
  });

  it("ignores other reqIds", () => {
    const parsed = parseCaseUnboxingPayload({ reqId: "other", result: {} }, "mine");
    expect(parsed.matched).toBe(false);
  });
});
