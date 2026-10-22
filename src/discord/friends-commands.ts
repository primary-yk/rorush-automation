import { encryptField, verifyRoRushEmailPassword } from "../accounts/session-manager.js";
import { RoRushHttpClient } from "../rorush/http-client.js";
import { formatWalletBalanceToken } from "../rorush/balance-token.js";
import {
  countRainJoinsToday,
  deleteAccount,
  getAccount,
  insertAccount,
  listAccounts,
  updateAccount,
  type AccountRow,
} from "../db/repositories.js";
import {
  clampLimboBetCoins,
  clampLimboMultiplier,
  effectiveLimboMinBetCoins,
  LIMBO_MIN_MULTIPLIER,
} from "../config.js";
import { engine } from "../worker/engine.js";
import { isAccountAutomationPaused } from "../accounts/account-automation.js";
import { appendSessionHintIfNeeded } from "./friends-auth-hints.js";
import { formatLifetimeShort, lifetimeBreakdown } from "./friends-lifetime.js";
import { vaultLockStatusLine } from "../automation/vault-lock-apply.js";

export function accountsForDiscordUser(discordUserId: string): AccountRow[] {
  return listAccounts().filter((a) => a.owner_discord_id === discordUserId);
}

export function findOwnedAccount(discordUserId: string, nickname: string): AccountRow | undefined {
  const q = nickname.trim().toLowerCase();
  return accountsForDiscordUser(discordUserId).find((a) => a.nickname.toLowerCase() === q);
}

function findAccountByNickname(nickname: string): AccountRow | undefined {
  const q = nickname.trim().toLowerCase();
  return listAccounts().find((a) => a.nickname.toLowerCase() === q);
}

export async function refreshAccountsForDiscordUser(
  discordUserId: string,
  nickname?: string,
): Promise<string> {
  const targets = nickname
    ? [findOwnedAccount(discordUserId, nickname)].filter((a): a is AccountRow => !!a)
    : accountsForDiscordUser(discordUserId);
  if (nickname && targets.length === 0) {
    return `No account **${nickname}** is linked to your Discord.\n\nAdd one with **\`/account add\`** or **\`/account session\`**.`;
  }
  if (targets.length === 0) {
    return "You have no accounts to refresh.\n\nLink RoRush with **\`/account add\`** or **\`/account session\`**.";
  }
  const results = await engine.refreshAccountStatsForIds(targets.map((a) => a.id));
  const lines: string[] = ["**Balances refreshed from RoRush**", ""];
  for (const r of results) {
    const row = getAccount(r.accountId);
    if (!row) continue;
    if (r.ok) {
      const bal = row.balance != null ? `${row.balance.toFixed(2)} coins` : "—";
      const lvl = row.level != null ? String(row.level) : "—";
      lines.push(`• **${row.nickname}** · ${bal} · lvl ${lvl}`);
    } else {
      lines.push(appendSessionHintIfNeeded(`• **${row.nickname}** · refresh failed — ${r.error ?? "unknown"}`, row));
    }
  }
  return lines.join("\n");
}

export async function setAccountAutomationPaused(input: {
  actorUserId: string;
  isHost: boolean;
  nickname: string;
  paused: boolean;
}): Promise<string> {
  const account = findAccountByNickname(input.nickname);
  if (!account) return `No account **${input.nickname}** on this host.`;
  const owner = account.owner_discord_id?.trim();
  if (!input.isHost && owner !== input.actorUserId) {
    return "You can only pause **your** accounts. Staff can pause any nickname.";
  }
  updateAccount(account.id, { automation_paused: input.paused ? 1 : 0 });
  await engine.reloadAccounts();
  const state = input.paused ? "**paused**" : "**resumed**";
  const scope = input.isHost && owner && owner !== input.actorUserId ? " (host override)" : "";
  return (
    `**${account.nickname}** automation is now ${state}${scope}.\n` +
    "Rain, cases, and limbo are skipped for this nickname until you resume.\n" +
    "Host **`/pause`** still stops automation for the entire server."
  );
}

export async function addAccountForDiscordUser(input: {
  discordUserId: string;
  nickname: string;
  email: string;
  password: string;
}): Promise<string> {
  const nick = input.nickname.trim();
  if (!nick) return "Nickname is required.";
  const taken = listAccounts().some((a) => a.nickname.toLowerCase() === nick.toLowerCase());
  if (taken) return `Nickname **${nick}** is already taken — pick another.`;

  const verified = await verifyRoRushEmailPassword(input.email, input.password);
  if (!verified.ok) return verified.message;

  const row = insertAccount({
    nickname: nick,
    username: input.email.trim(),
    password_enc: encryptField(input.password),
    session_jwt_enc: encryptField(verified.jwt),
    api_key_enc: verified.apiKey ? encryptField(verified.apiKey) : null,
    proxy_url: null,
    owner_discord_id: input.discordUserId,
  });
  if (verified.level != null) {
    updateAccount(row.id, { level: verified.level });
  }
  await engine.reloadAccounts();
  return (
    `**${nick}** is linked and ready.\n\n` +
    "Open **`/dashboard`** to enable rain with buttons, or use **`/rain`**, **`/cases`**, and **`/limbo set`**."
  );
}

export async function addAccountSessionForDiscordUser(input: {
  discordUserId: string;
  nickname: string;
  sessionJwt: string;
  apiKey?: string;
}): Promise<string> {
  const nick = input.nickname.trim();
  if (!nick) return "Nickname is required.";
  const jwt = input.sessionJwt.trim();
  if (jwt.length < 32) {
    return "Session token looks incomplete. Paste the full JWT from rorush.com (same as the dashboard **Session JWT** field).";
  }
  const taken = listAccounts().some((a) => a.nickname.toLowerCase() === nick.toLowerCase());
  if (taken) return `Nickname **${nick}** is already taken — pick another.`;

  const apiKey = input.apiKey?.trim() || undefined;
  const client = new RoRushHttpClient({ jwt, apiKey }, null);
  try {
    const status = await client.authStatus();
    if (status.authenticated === false) {
      return "That session token is expired or invalid. Log in on rorush.com again, copy a fresh JWT, and retry.";
    }
  } catch {
    return "Could not verify that session token. Check the paste and try again, or use `/account add` with email and password.";
  }

  insertAccount({
    nickname: nick,
    username: null,
    password_enc: null,
    session_jwt_enc: encryptField(jwt),
    api_key_enc: apiKey ? encryptField(apiKey) : null,
    proxy_url: null,
    owner_discord_id: input.discordUserId,
  });
  await engine.reloadAccounts();
  return (
    `**${nick}** is linked via session JWT (password not stored).\n\n` +
    "Use **`/dashboard`** to turn on automation. When the token expires, run **`/account session`** again with a fresh JWT."
  );
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
    return "You have no accounts yet. Use `/account add` or `/account session` — only you see the reply.";
  }
  const joinsToday = countRainJoinsToday(accounts.map((a) => a.id));
  const lines = accounts.map((a) =>
    formatOneAccount(a, accounts.length === 1 ? joinsToday : undefined),
  );
  if (accounts.length > 1) {
    lines.push(`**Rain joins today (all yours):** ${joinsToday}`);
  }
  return lines.join("\n\n");
}

function formatOneAccount(a: AccountRow, joinsToday?: number): string {
  const bal = a.balance != null ? a.balance.toFixed(2) : "—";
  const walletMode = formatWalletBalanceToken(a.wallet_balance_token);
  const vault = a.vault_balance != null ? a.vault_balance.toFixed(2) : "—";
  const lvl = a.level != null ? String(a.level) : "—";
  const flags = [
    a.join_rain ? "rain" : null,
    a.auto_open_cases ? "cases" : null,
    a.limbo_wager_enabled ? `limbo ${clampLimboMultiplier(a.limbo_multiplier).toFixed(2)}×` : null,
    a.auto_vault_deposit ? "vault rain profit" : null,
    vaultLockStatusLine(a),
    a.pre_wager_before_rain ? "pre-wager" : null,
    a.min_rain_amount > 0 ? `min pool ${a.min_rain_amount.toFixed(0)}` : null,
  ]
    .filter(Boolean)
    .join(", ");
  const life = formatLifetimeShort(lifetimeBreakdown(a));
  const paused = isAccountAutomationPaused(a) ? " · **automation paused**" : "";
  const joins =
    joinsToday != null && joinsToday > 0 ? ` · **${joinsToday}** rain join(s) today` : "";
  let line =
    `• **${a.nickname}** · wallet **${bal}** (${walletMode}) · vault **${vault}** · lvl ${lvl}${paused}${joins}\n  ${life}\n  ${flags || "all automation off"} · ${a.status}`;
  line = appendSessionHintIfNeeded(line, a);
  return line;
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
  const label = field === "join_rain" ? "Auto rain join" : "Auto case opens";
  return (
    `**${account.nickname}**\n${label} is now **${enabled ? "ON" : "OFF"}**.\n` +
    (enabled
      ? "You will see join results in your private feed thread."
      : "This account will not join new rains until you turn it back on.")
  );
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
    patch.limbo_multiplier = clampLimboMultiplier(input.multiplier);
  }
  if (input.betCoins != null) {
    patch.limbo_bet_coins = clampLimboBetCoins(input.betCoins);
  }
  updateAccount(account.id, patch);
  await engine.reloadAccounts();
  const row = getAccount(account.id)!;
  return (
    `**${row.nickname}** — limbo wager **${row.limbo_wager_enabled ? "ON" : "OFF"}**\n` +
    `Target **${row.limbo_multiplier.toFixed(2)}×** · fallback bet **${row.limbo_bet_coins.toFixed(2)}** coins`
  );
}

export async function setAutoVaultDeposit(
  discordUserId: string,
  nickname: string,
  enabled: boolean,
): Promise<string> {
  const account = findOwnedAccount(discordUserId, nickname);
  if (!account) return `No account **${nickname}** saved for you. Use \`/account add\`.`;
  updateAccount(account.id, { auto_vault_deposit: enabled ? 1 : 0 });
  await engine.reloadAccounts();
  return (
    `**${account.nickname}** · Auto vault **${enabled ? "ON" : "OFF"}** — ` +
    (enabled
      ? "after each rain (+ limbo if enabled), profit above your pre-rain wallet balance moves to **RoRush vault** (until you turn it off)."
      : "rain profits stay in your wallet. For a **timed** lock + optional rain vault, use **`/rorush vault`**.")
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
  const minBet = effectiveLimboMinBetCoins();
  if (!Number.isFinite(betCoins) || betCoins < minBet) {
    return `Limbo bet must be at least **${minBet.toFixed(2)}** coins on RoRush.`;
  }
  const mult = multiplier ?? account.limbo_multiplier;
  const result = await engine.testLimbo(account.id, betCoins, mult);
  const setMult = Math.max(LIMBO_MIN_MULTIPLIER, mult).toFixed(2);
  const outcome = result.hit ? "Win" : "Loss";
  return (
    `**${account.nickname}** · Test limbo **${outcome}** · ` +
    `${result.betCoins.toFixed(2)} coins · set **${setMult}×**`
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
