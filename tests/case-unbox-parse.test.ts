import { describe, expect, it } from "vitest";
import {
  normalizeCaseItemImageUrl,
  parseCaseUnboxingPayload,
} from "../src/rorush/case-unbox-parse.js";

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

  it("normalizes protocol-relative and site-relative image URLs", () => {
    expect(normalizeCaseItemImageUrl("//cdn.example/skin.png")).toBe("https://cdn.example/skin.png");
    expect(normalizeCaseItemImageUrl("/assets/item.webp")).toBe("https://rorush.com/assets/item.webp");
  });

  it("reads wonItems on result root", () => {
    const parsed = parseCaseUnboxingPayload(
      {
        reqId: "x",
        result: {
          wonItems: [{ name: "Knife", imageUrl: "https://cdn.example/k.png", price: 5000 }],
        },
      },
      "x",
    );
    expect(parsed.items[0]?.name).toBe("Knife");
    expect(parsed.items[0]?.priceCoins).toBe(50);
  });
});
