import { describe, expect, it } from "vitest";
import { limboOutcomeEmbedCopy, rainJoinEmbedCopy } from "../src/discord/embeds.js";

describe("limboOutcomeEmbedCopy", () => {
  it("uses result and set multiplier wording", () => {
    const hit = limboOutcomeEmbedCopy({ hit: true, targetMultiplier: 1.5, resultMultiplier: 1.61 });
    expect(hit.title).toBe("Limbo · Win");
    expect(hit.description).toContain("1.61×");
    expect(hit.description).toContain("1.50×");
    expect(hit.description.toLowerCase()).not.toContain("crash");

    const miss = limboOutcomeEmbedCopy({ hit: false, targetMultiplier: 1.5, resultMultiplier: 1.12 });
    expect(miss.title).toBe("Limbo · Loss");
    expect(miss.description.toLowerCase()).not.toContain("crash");
  });
});

describe("rainJoinEmbedCopy", () => {
  it("uses join confirmed title", () => {
    const ok = rainJoinEmbedCopy(true);
    expect(ok.title).toBe("Rain · Join confirmed");
  });
});
