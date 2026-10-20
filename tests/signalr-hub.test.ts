import { describe, expect, it } from "vitest";
import { hubEventVariants } from "../src/rorush/signalr-hub.js";

describe("hubEventVariants", () => {
  it("includes PascalCase, camelCase, and lowercase", () => {
    const v = hubEventVariants("ReceiveJoinRainSuccess");
    expect(v).toContain("ReceiveJoinRainSuccess");
    expect(v).toContain("receiveJoinRainSuccess");
    expect(v).toContain("receivejoinrainsuccess");
  });
});
