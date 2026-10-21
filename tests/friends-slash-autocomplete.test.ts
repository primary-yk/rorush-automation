import { describe, expect, it, beforeEach } from "vitest";
import { getDb } from "../src/db/database.js";
import { insertAccount } from "../src/db/repositories.js";
import { accountNicknameAutocompleteChoices } from "../src/discord/friends-slash-autocomplete.js";

describe("account nickname autocomplete", () => {
  beforeEach(() => {
    getDb().exec("DELETE FROM accounts");
  });

  it("lists only owned accounts for members", () => {
    insertAccount({ nickname: "Mine", owner_discord_id: "u1" });
    insertAccount({ nickname: "Other", owner_discord_id: "u2" });
    const choices = accountNicknameAutocompleteChoices({
      discordUserId: "u1",
      focusedValue: "",
      includeAllHostAccounts: false,
    });
    expect(choices.map((c) => c.value)).toEqual(["Mine"]);
  });

  it("filters by focused text", () => {
    insertAccount({ nickname: "Alpha", owner_discord_id: "u1" });
    insertAccount({ nickname: "Beta", owner_discord_id: "u1" });
    const choices = accountNicknameAutocompleteChoices({
      discordUserId: "u1",
      focusedValue: "al",
      includeAllHostAccounts: false,
    });
    expect(choices.map((c) => c.value)).toEqual(["Alpha"]);
  });
});
