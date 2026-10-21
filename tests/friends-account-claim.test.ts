import { beforeEach, describe, expect, it, vi } from "vitest";

const reloadAccounts = vi.fn(async () => undefined);
vi.mock("../src/worker/engine.js", () => ({
  engine: { reloadAccounts },
}));

vi.mock("../src/db/repositories.js", () => {
  const rows: Array<{
    id: number;
    nickname: string;
    owner_discord_id: string | null;
  }> = [];
  return {
    listAccounts: () => rows as never[],
    getAccount: (id: number) => rows.find((r) => r.id === id) as never,
    updateAccount: (id: number, patch: { owner_discord_id?: string }) => {
      const row = rows.find((r) => r.id === id);
      if (!row) return undefined;
      if (patch.owner_discord_id !== undefined) row.owner_discord_id = patch.owner_discord_id;
      return row as never;
    },
    insertAccount: vi.fn(),
    deleteAccount: vi.fn(),
    __testRows: rows,
  };
});

const repos = await import("../src/db/repositories.js");
const { claimAccountForDiscordUser } = await import("../src/discord/friends-commands.js");

beforeEach(() => {
  reloadAccounts.mockClear();
  (repos as { __testRows: typeof repos extends { __testRows: infer R } ? R : never }).__testRows.length = 0;
});

describe("claimAccountForDiscordUser", () => {
  it("links unowned dashboard account", async () => {
    (repos as { __testRows: Array<{ id: number; nickname: string; owner_discord_id: string | null }> }).__testRows.push({
      id: 1,
      nickname: "Main",
      owner_discord_id: null,
    });
    const msg = await claimAccountForDiscordUser("user-1", "Main");
    expect(msg).toMatch(/Linked/);
    expect(reloadAccounts).toHaveBeenCalled();
  });

  it("rejects when already owned by someone else", async () => {
    (repos as { __testRows: Array<{ id: number; nickname: string; owner_discord_id: string | null }> }).__testRows.push({
      id: 1,
      nickname: "Main",
      owner_discord_id: "other",
    });
    const msg = await claimAccountForDiscordUser("user-1", "Main");
    expect(msg).toMatch(/another Discord user/);
  });
});
