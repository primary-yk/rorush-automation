import { describe, expect, it } from "vitest";
import { buildCaseWinFeedEmbed } from "../src/discord/friends-case-feed.js";

describe("buildCaseWinFeedEmbed", () => {
  it("includes item name, price field, and image", () => {
    const embed = buildCaseWinFeedEmbed({
      slotLabel: "Weekly",
      nickname: "fi",
      totalCoins: 3.25,
      items: [
        {
          name: "Emerald Ring",
          priceCoins: 3.25,
          imageUrl: "https://cdn.example/ring.png",
        },
      ],
    });
    expect(embed.title).toBe("Cases · Weekly");
    expect(embed.image?.url).toBe("https://cdn.example/ring.png");
    const itemField = embed.fields?.find((f) => f.name === "Item");
    expect(itemField?.value).toContain("Emerald Ring");
    const priceField = embed.fields?.find((f) => f.name === "Price");
    expect(priceField?.value).toContain("3.25");
  });
});
