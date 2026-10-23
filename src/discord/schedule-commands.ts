import {
  formatScheduleRemaining,
  scheduleActive,
  SCHEDULE_MAX_HOURS,
  SCHEDULE_MIN_HOURS,
  startAccountSchedule,
  stopAccountSchedule,
} from "../automation/account-schedule.js";
import { getAccount, listAccounts, updateAccount, type AccountRow } from "../db/repositories.js";
import { engine } from "../worker/engine.js";

function findOwnedAccount(discordUserId: string, nickname?: string): AccountRow | undefined {
  const owned = listAccounts().filter((a) => a.owner_discord_id === discordUserId);
  if (nickname?.trim()) {
    const q = nickname.trim().toLowerCase();
    return owned.find((a) => a.nickname.toLowerCase() === q);
  }
  return owned[0];
}

export async function startScheduleForUser(input: {
  discordUserId: string;
  nickname: string;
  hours: number;
}): Promise<string> {
  const account = findOwnedAccount(input.discordUserId, input.nickname);
  if (!account) return `No account **${input.nickname}** saved for you. Use **/account add**.`;

  if (input.hours < SCHEDULE_MIN_HOURS || input.hours > SCHEDULE_MAX_HOURS) {
    return `Hours must be between **${SCHEDULE_MIN_HOURS}** and **${SCHEDULE_MAX_HOURS}** (one week).`;
  }

  const { endsAtMs } = await startAccountSchedule({ accountId: account.id, hours: input.hours });
  await engine.reloadAccounts();

  const endsLocal = new Date(endsAtMs).toLocaleString("en-US", {
    timeZone: "America/Los_Angeles",
    dateStyle: "short",
    timeStyle: "short",
  });

  return (
    `**${account.nickname}** · Scheduled **${input.hours}** hour(s).\n` +
    `Rain join, auto cases, and post-rain limbo are **ON** until **${endsLocal} (Pacific)** (~**${formatScheduleRemaining(endsAtMs)}** left).\n` +
    "When time is up, rain and cases turn **OFF** automatically. Cancel early with **`/schedule stop`**."
  );
}

export async function stopScheduleForUser(discordUserId: string, nickname?: string): Promise<string> {
  const account = findOwnedAccount(discordUserId, nickname);
  if (!account) return nickname ? `No account **${nickname}** linked.` : "No linked account.";
  stopAccountSchedule(account.id);
  await engine.reloadAccounts();
  return `**${account.nickname}** · Schedule **cancelled**. Rain and auto cases are **OFF**.`;
}

export function scheduleStatusForUser(discordUserId: string, nickname?: string): string {
  const owned = listAccounts().filter((a) => a.owner_discord_id === discordUserId);
  const account = nickname?.trim()
    ? owned.find((a) => a.nickname.toLowerCase() === nickname.trim().toLowerCase())
    : owned.length === 1
      ? owned[0]
      : undefined;

  if (nickname && !account) return `No account **${nickname}** linked.`;
  if (!account) {
    if (owned.length === 0) return "No linked accounts.";
    const lines = owned.map((a) => scheduleLine(a));
    return `**Schedule status**\n${lines.join("\n")}`;
  }
  return scheduleLine(account);
}

function scheduleLine(account: AccountRow): string {
  const end = account.schedule_ends_at_ms;
  if (!scheduleActive(account)) {
    return `**${account.nickname}** · No active schedule · rain **${account.join_rain ? "on" : "off"}** · cases **${account.auto_open_cases ? "on" : "off"}**`;
  }
  return (
    `**${account.nickname}** · Schedule **active** · **${formatScheduleRemaining(end!)}** left\n` +
    `Rain **on** · cases **on** · ends ${new Date(end!).toLocaleString("en-US", { timeZone: "America/Los_Angeles", timeStyle: "short", dateStyle: "short" })} Pacific`
  );
}

/** Disable mines on all accounts (feature removed). */
export function disableMinesOnAllAccounts(): void {
  for (const a of listAccounts()) {
    if (Number(a.mines_auto_enabled) === 0 && Number(a.mines_auto_rains_remaining) === 0) continue;
    updateAccount(a.id, { mines_auto_enabled: 0, mines_auto_rains_remaining: 0 });
  }
}
