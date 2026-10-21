import { describe, expect, it } from "vitest";
import {
  lifetimeByDiscordOwner,
  lifetimeBreakdown,
  sumLifetimeBreakdown,
} from "../src/discord/friends-lifetime.js";
import type { AccountRow } from "../src/db/repositories.js";

function acct(partial: Partial<AccountRow> & Pick<AccountRow, "nickname">): AccountRow {
  return {
    id: 1,
    owner_discord_id: null,
    username: null,
    password_enc: null,
    session_jwt_enc: null,
    api_key_enc: null,
    proxy_url: null,
    join_rain: 0,
    min_rain_amount: 0,
    auto_open_cases: 0,
    auto_redeem_codes: 0,
    min_code_level: 0,
    limbo_wager_enabled: 0,
    limbo_multiplier: 2,
    limbo_bet_coins: 1,
    pre_wager_before_rain: 0,
    status: "idle",
    last_error: null,
    balance: null,
    level: null,
    lifetime_rain: 0,
    lifetime_cases: 0,
    lifetime_codes: 0,
    created_at: "",
    updated_at: "",
    ...partial,
  };
}

describe("friends-lifetime", () => {
  it("sums breakdown", () => {
    const b = lifetimeBreakdown(acct({ nickname: "a", lifetime_rain: 10, lifetime_cases: 5, lifetime_codes: 1 }));
    expect(b.total).toBe(16);
  });

  it("groups by discord owner", () => {
    const map = lifetimeByDiscordOwner([
      acct({ nickname: "a", owner_discord_id: "u1", lifetime_rain: 10 }),
      acct({ nickname: "b", owner_discord_id: "u1", lifetime_cases: 3 }),
      acct({ nickname: "c", owner_discord_id: "u2", lifetime_rain: 7 }),
    ]);
    expect(map.get("u1")?.total).toBe(13);
    expect(map.get("u2")?.total).toBe(7);
    expect(sumLifetimeBreakdown([acct({ nickname: "x", lifetime_rain: 1 })]).total).toBe(1);
  });
});
