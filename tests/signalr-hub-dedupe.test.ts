import { describe, expect, it } from "vitest";
import { RoRushHub } from "../src/rorush/signalr-hub.js";

describe("RoRushHub event dedupe keys", () => {
  it("keys rain lifecycle by rainId", () => {
    const hub = new RoRushHub({ jwt: "t", apiKey: "k" });
    const key = hub.eventDedupeKey("ReceiveRainCreated", { rainId: "abc", amount: 100 });
    expect(key).toBe("ReceiveRainCreated:abc");
  });
});
