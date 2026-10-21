import { describe, expect, it } from "vitest";
import { isHostOnlyActivityLog } from "../src/discord/friends-activity-routing.js";

describe("isHostOnlyActivityLog", () => {
  it("keeps member success paths in user feeds", () => {
    expect(
      isHostOnlyActivityLog({
        message: "Vaulted rain profit",
        detail: "1.00 coins",
        category: "vault",
        account_id: 1,
        created_at: new Date().toISOString(),
      }),
    ).toBe(false);
    expect(
      isHostOnlyActivityLog({
        message: "Joined rain",
        detail: "abc",
        category: "rain",
        account_id: 1,
        created_at: new Date().toISOString(),
      }),
    ).toBe(false);
  });

  it("routes failures to host only", () => {
    expect(
      isHostOnlyActivityLog({
        message: "Vault deposit failed",
        detail: "HTTP 400",
        category: "system",
        account_id: 1,
        created_at: new Date().toISOString(),
      }),
    ).toBe(true);
    expect(
      isHostOnlyActivityLog({
        message: "Rain join failed",
        detail: "captcha",
        category: "rain",
        account_id: 1,
        created_at: new Date().toISOString(),
      }),
    ).toBe(true);
  });
});
