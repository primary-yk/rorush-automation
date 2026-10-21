import { describe, expect, it } from "vitest";
import { isInteractionAlreadyAcknowledged } from "../src/discord/friends-interaction.js";

describe("friends-interaction", () => {
  it("detects duplicate ack errors", () => {
    expect(isInteractionAlreadyAcknowledged(new Error("Interaction has already been acknowledged."))).toBe(true);
    expect(isInteractionAlreadyAcknowledged({ code: 40060 })).toBe(true);
    expect(isInteractionAlreadyAcknowledged(new Error("Missing permissions"))).toBe(false);
  });
});
