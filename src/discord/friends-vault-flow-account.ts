import { getAccount, listAccounts } from "../db/repositories.js";

export function findOwnedAccount(discordUserId: string, accountId: number) {
  const row = getAccount(accountId);
  if (!row || row.owner_discord_id !== discordUserId) return null;
  return row;
}

export function ownedAccountsForUser(discordUserId: string) {
  return listAccounts().filter((a) => a.owner_discord_id === discordUserId);
}
