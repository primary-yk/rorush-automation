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

  it("preserves encryption / path diagnostics for hosts", () => {
    const raw =
      "ENCRYPTION_KEY missing in /workspace/.env. This bot process: /workspace · vm. Reset DISCORD_BOT_TOKEN.";
    const out = sanitizeDiscordOutbound(raw);
    expect(out).toContain("/workspace");
    expect(out).toContain("ENCRYPTION_KEY");
    expect(out).not.toMatch(/ping @28ub shows the key/i);
  });
});
