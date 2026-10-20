import { describe, expect, it, beforeEach } from "vitest";
import { getDb } from "../src/db/database.js";
import { insertAccount, getAccount, updateAccount } from "../src/db/repositories.js";

describe("updateAccount join_rain", () => {
  beforeEach(() => {
    getDb().exec("DELETE FROM accounts");
  });

  it("does not change join_rain on automation-style patches", () => {
    const row = insertAccount({ nickname: "test-pilot" });
    updateAccount(row.id, { join_rain: 1 }, { allowJoinRainChange: true });
    updateAccount(row.id, { status: "error", last_error: "Captcha token missing" });
    const after = getAccount(row.id)!;
    expect(after.join_rain).toBe(1);
  });

  it("allows join_rain off only when explicitly permitted", () => {
    const row = insertAccount({ nickname: "test-pilot" });
    updateAccount(row.id, { join_rain: 1 }, { allowJoinRainChange: true });
    updateAccount(row.id, { join_rain: 0 }, { allowJoinRainChange: true });
    expect(getAccount(row.id)!.join_rain).toBe(0);
  });
});
