import { describe, expect, it } from "vitest";
import { sanitizeDiscordOutbound } from "../src/discord/sanitize-outbound.js";

describe("sanitizeDiscordOutbound", () => {
  it("removes http URLs and local dashboard ports", () => {
    const raw = "Open http://127.0.0.1:43123 and https://rorush.com/rain then npm run dev";
    const out = sanitizeDiscordOutbound(raw);
    expect(out).not.toMatch(/https?:\/\//);
    expect(out).not.toMatch(/43123/);
    expect(out).toMatch(/@28ub/i);
  });
});
