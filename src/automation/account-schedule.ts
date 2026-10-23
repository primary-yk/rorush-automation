import { appendLog, listAccounts, updateAccount, type AccountRow } from "../db/repositories.js";
import { deliverFriendsReporterEmbed } from "../discord/friends-feed.js";
import { COLORS } from "../discord/embeds.js";

export const SCHEDULE_MIN_HOURS = 0.25;
export const SCHEDULE_MAX_HOURS = 168;

export function formatScheduleRemaining(endsAtMs: number, now = Date.now()): string {
  const ms = Math.max(0, endsAtMs - now);
  if (ms <= 0) return "ended";
  const totalMin = Math.ceil(ms / 60_000);
  const h = Math.floor(totalMin / 60);
  const m = totalMin % 60;
  if (h <= 0) return `${m} min`;
  if (m === 0) return `${h} h`;
  return `${h} h ${m} min`;
}

export function scheduleActive(account: AccountRow, now = Date.now()): boolean {
  const end = account.schedule_ends_at_ms;
  return end != null && Number.isFinite(end) && end > now;
}

export async function startAccountSchedule(input: {
  accountId: number;
  hours: number;
}): Promise<{ endsAtMs: number }> {
  const hours = Math.min(SCHEDULE_MAX_HOURS, Math.max(SCHEDULE_MIN_HOURS, input.hours));
  const endsAtMs = Date.now() + Math.round(hours * 3_600_000);
  updateAccount(
    input.accountId,
    {
      schedule_ends_at_ms: endsAtMs,
      join_rain: 1,
      auto_open_cases: 1,
      automation_paused: 0,
      limbo_wager_enabled: 1,
      mines_auto_enabled: 0,
      mines_auto_rains_remaining: 0,
    },
    { allowJoinRainChange: true },
  );
  appendLog({
    accountId: input.accountId,
    category: "schedule",
    message: "Automation schedule started",
    detail: `${hours}h · ends ${new Date(endsAtMs).toISOString()}`,
  });
  return { endsAtMs };
}

export function stopAccountSchedule(accountId: number): void {
  updateAccount(
    accountId,
    {
      schedule_ends_at_ms: null,
      join_rain: 0,
      auto_open_cases: 0,
    },
    { allowJoinRainChange: true },
  );
  appendLog({
    accountId,
    category: "schedule",
    message: "Automation schedule stopped",
    detail: "Rain and cases turned off",
  });
}

async function notifyScheduleEnded(account: AccountRow): Promise<void> {
  if (!account.owner_discord_id?.trim()) return;
  await deliverFriendsReporterEmbed(
    {
      title: "Schedule finished",
      description:
        `**${account.nickname}** · Your scheduled automation window is over.\n` +
        "Rain join and auto cases are **OFF**. Start again with **`/schedule start`**.",
      color: COLORS.limboSkip,
    },
    { accountId: account.id, nickname: account.nickname },
  );
}

/** Turn off automation when scheduled end time passes. */
export async function expireDueAccountSchedules(): Promise<number> {
  const now = Date.now();
  let count = 0;
  for (const account of listAccounts()) {
    const end = account.schedule_ends_at_ms;
    if (end == null || !Number.isFinite(end) || end > now) continue;
    updateAccount(
      account.id,
      {
        schedule_ends_at_ms: null,
        join_rain: 0,
        auto_open_cases: 0,
      },
      { allowJoinRainChange: true },
    );
    appendLog({
      accountId: account.id,
      category: "schedule",
      message: "Automation schedule ended",
      detail: "Rain and cases turned off automatically",
    });
    void notifyScheduleEnded(account);
    count++;
  }
  return count;
}
