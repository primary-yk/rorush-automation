import { describe, expect, it } from "vitest";
import { assessAccountSessionHealth, parseJwtExpiryUtc } from "../src/discord/friends-session-health.js";
import type { AccountRow } from "../src/db/repositories.js";

function baseRow(overrides: Partial<AccountRow>): AccountRow {
  return {
    id: 1,
    nickname: "test",
    owner_discord_id: "u1",
    username: null,
    password_enc: null,
    session_jwt_enc: null,
    api_key_enc: null,
    proxy_url: null,
    join_rain: 0,
    auto_open_cases: 0,
    limbo_wager_enabled: 0,
    limbo_multiplier: 1.5,
    limbo_bet_coins: 5,
    auto_vault_deposit: 0,
    vault_session_auto_deposit: 0,
    automation_paused: 0,
    pre_wager_before_rain: 0,
    min_rain_amount: 0,
    status: "idle",
    last_error: null,
    balance: null,
    vault_balance: null,
    level: null,
    created_at: "",
    updated_at: "",
    ...overrides,
  } as AccountRow;
}

describe("parseJwtExpiryUtc", () => {
  it("reads exp from payload", () => {
    const header = Buffer.from(JSON.stringify({ alg: "none" })).toString("base64url");
    const exp = Math.floor(new Date("2030-01-01T00:00:00Z").getTime() / 1000);
    const payload = Buffer.from(JSON.stringify({ exp })).toString("base64url");
    const jwt = `${header}.${payload}.sig`;
    const date = parseJwtExpiryUtc(jwt);
    expect(date?.toISOString()).toBe("2030-01-01T00:00:00.000Z");
  });
});

describe("assessAccountSessionHealth", () => {
  it("flags session-only auth errors", () => {
    const row = baseRow({
      session_jwt_enc: "enc",
      last_error: "401 unauthorized",
      status: "error",
    });
    const s = assessAccountSessionHealth(row);
    expect(s.level).toBe("action");
    expect(s.label).toMatch(/login/i);
  });

  it("treats password login as healthy when idle", () => {
    const row = baseRow({ password_enc: "enc" });
    const s = assessAccountSessionHealth(row);
    expect(s.level).toBe("healthy");
    expect(s.label).toMatch(/password/i);
  });
});
