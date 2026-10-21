import { getSettings, type AccountRow } from "../db/repositories.js";

export function isAccountAutomationPaused(account: AccountRow): boolean {
  return Number(account.automation_paused ?? 0) !== 0;
}

export function isAccountAutomationActive(account: AccountRow, globalPause = getSettings().global_pause): boolean {
  if (Number(globalPause) !== 0) return false;
  return !isAccountAutomationPaused(account);
}

export function accountEligibleForRain(account: AccountRow): boolean {
  return isAccountAutomationActive(account) && Number(account.join_rain) !== 0;
}

export function accountEligibleForCases(account: AccountRow): boolean {
  return isAccountAutomationActive(account) && Number(account.auto_open_cases) !== 0;
}
