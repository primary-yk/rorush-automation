import { encryptField } from "../accounts/session-manager.js";
import {
  deleteAccount,
  getAccount,
  insertAccount,
  listAccounts,
  updateAccount,
  type AccountRow,
} from "../db/repositories.js";
import { LIMBO_MIN_MULTIPLIER } from "../config.js";
import { engine } from "../worker/engine.js";

export function accountsForDiscordUser(discordUserId: string): AccountRow[] {
  return listAccounts().filter((a) => a.owner_discord_id === discordUserId);
}

export function findOwnedAccount(discordUserId: string, nickname: string): AccountRow | undefined {
  const q = nickname.trim().toLowerCase();
  return accountsForDiscordUser(discordUserId).find((a) => a.nickname.toLowerCase() === q);
}

export async function addAccountForDiscordUser(input: {
  discordUserId: string;
  nickname: string;
  email: string;
  password: string;
}): Promise<string> {
  const nick = input.nickname.trim();
  if (!nick) return "Nickname is required.";
  const exists = listAccounts().some((a) => a.nickname.toLowerCase() === nick.toLowerCase());
  if (exists) return `Nickname **${nick}** is already taken — pick another.`;

  insertAccount({
    nickname: nick,
    username: input.email.trim(),
    password_enc: encryptField(input.password),
    session_jwt_enc: null,
    api_key_enc: null,
    proxy_url: null,
    owner_discord_id: input.discordUserId,
  });
  await engine.reloadAccounts();
  return `Saved **${nick}**. Use \`/account list\`, then \`/rain\`, \`/cases\`, and \`/limbo\`.`;
}

export async function removeAccountForDiscordUser(
  discordUserId: string,
  nickname: string,
): Promise<string> {
  const account = findOwnedAccount(discordUserId, nickname);
  if (!account) return `No account **${nickname}** saved for you. Use \`/account add\`.`;
  deleteAccount(account.id);
  await engine.reloadAccounts();
  return `Removed **${account.nickname}**.`;
}

export function formatAccountList(discordUserId: string): string {
  const accounts = accountsForDiscordUser(discordUserId);
  if (accounts.length === 0) {
    return "You have no accounts yet. Use `/account add` (only you see the password).";
  }
  return accounts.map(formatOneAccount).join("\n\n");
}

function formatOneAccount(a: AccountRow): string {
  const bal = a.balance != null ? a.balance.toFixed(2) : "—";
  const lvl = a.level != null ? String(a.level) : "—";
  const flags = [
    a.join_rain ? "rain" : null,
    a.auto_open_cases ? "cases" : null,
    a.limbo_wager_enabled ? `limbo ${a.limbo_multiplier.toFixed(2)}×` : null,
    a.pre_wager_before_rain ? "pre-wager" : null,
    a.min_rain_amount > 0 ? `min pool ${a.min_rain_amount.toFixed(0)}` : null,
  ]
    .filter(Boolean)
    .join(", ");
  return `• **${a.nickname}** · ${bal} coins · lvl ${lvl}\n  ${flags || "all automation off"} · ${a.status}`;
}

export async function setToggle(
  discordUserId: string,
  nickname: string,
  field: "join_rain" | "auto_open_cases",
  enabled: boolean,
): Promise<string> {
  const account = findOwnedAccount(discordUserId, nickname);
  if (!account) return `No account **${nickname}** saved for you. Use \`/account add\`.`;
  updateAccount(
    account.id,
    { [field]: enabled ? 1 : 0 },
    { allowJoinRainChange: field === "join_rain" },
  );
  await engine.reloadAccounts();
  const label = field === "join_rain" ? "Join rain" : "Auto cases";
  return `**${account.nickname}** · ${label} **${enabled ? "ON" : "OFF"}**`;
}

export async function setLimbo(
  discordUserId: string,
  nickname: string,
  input: { enabled: boolean; multiplier?: number; betCoins?: number },
): Promise<string> {
  const account = findOwnedAccount(discordUserId, nickname);
  if (!account) return `No account **${nickname}** saved for you. Use \`/account add\`.`;
  const patch: Parameters<typeof updateAccount>[1] = {
    limbo_wager_enabled: input.enabled ? 1 : 0,
  };
  if (input.multiplier != null) {
    patch.limbo_multiplier = Math.max(LIMBO_MIN_MULTIPLIER, input.multiplier);
  }
  if (input.betCoins != null) {
    patch.limbo_bet_coins = Math.max(0.01, input.betCoins);
  }
  updateAccount(account.id, patch);
  await engine.reloadAccounts();
  const row = getAccount(account.id)!;
  return (
    `**${row.nickname}** · Limbo wager **${row.limbo_wager_enabled ? "ON" : "OFF"}** · ` +
    `${row.limbo_multiplier.toFixed(2)}× · fallback bet ${row.limbo_bet_coins.toFixed(2)} coins`
  );
}

export async function setRainFilters(
  discordUserId: string,
  nickname: string,
  input: { minRainCoins?: number; preWagerBeforeRain?: boolean },
): Promise<string> {
  const account = findOwnedAccount(discordUserId, nickname);
  if (!account) return `No account **${nickname}** saved for you. Use \`/account add\`.`;
  const patch: Parameters<typeof updateAccount>[1] = {};
  if (input.minRainCoins != null) {
    patch.min_rain_amount = Math.max(0, input.minRainCoins);
  }
  if (input.preWagerBeforeRain != null) {
    patch.pre_wager_before_rain = input.preWagerBeforeRain ? 1 : 0;
  }
  if (Object.keys(patch).length === 0) {
    return `**${account.nickname}** · min pool **${account.min_rain_amount.toFixed(2)}** · pre-rain wager **${account.pre_wager_before_rain ? "ON" : "OFF"}**`;
  }
  updateAccount(account.id, patch);
  await engine.reloadAccounts();
  const row = getAccount(account.id)!;
  return (
    `**${row.nickname}** · min rain pool **${row.min_rain_amount.toFixed(2)}** coins · ` +
    `pre-rain wager **${row.pre_wager_before_rain ? "ON" : "OFF"}**`
  );
}

export async function testLimboForDiscordUser(
  discordUserId: string,
  nickname: string,
  betCoins: number,
  multiplier?: number,
): Promise<string> {
  const account = findOwnedAccount(discordUserId, nickname);
  if (!account) return `No account **${nickname}** saved for you. Use \`/account add\`.`;
  if (!Number.isFinite(betCoins) || betCoins < 0.01) {
    return "Bet must be at least **0.01** coins.";
  }
  const mult = multiplier ?? account.limbo_multiplier;
  const result = await engine.testLimbo(account.id, betCoins, mult);
  return (
    `**${account.nickname}** · Test limbo **${result.hit ? "HIT" : "miss"}** · ` +
    `${result.betCoins.toFixed(2)} coins @ ${Math.max(LIMBO_MIN_MULTIPLIER, mult).toFixed(2)}×`
  );
}

export function engineStatusText(): string {
  const accounts = listAccounts();
  const friends = new Set(accounts.map((a) => a.owner_discord_id).filter(Boolean));
  return [
    "**Status**",
    "Automation is **online**.",
    `Accounts: **${accounts.length}** · **${friends.size}** member(s) with saved logins`,
    "Use `/account list`, `/rain`, `/limbo`, `/cases`.",
  ].join("\n");
}
