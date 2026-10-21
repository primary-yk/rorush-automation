import {
  appendLog,
  listAccounts,
  recordCaseOpen,
  updateAccount,
} from "../db/repositories.js";
import type { CaseWonItem } from "../rorush/case-unbox-parse.js";
import { isIgnorableCaseError } from "./case-errors.js";
import { notifyCaseWinInUserFeed } from "../discord/friends-case-feed.js";

export function applyCaseOpenOutcome(input: {
  accountId: number;
  caseId: string;
  caseKind: string;
  slotLabel?: string;
  outcome: { ok: boolean; rewardCoins: number; items: CaseWonItem[]; message: string };
}): void {
  recordCaseOpen({
    accountId: input.accountId,
    caseId: input.caseId,
    caseKind: input.caseKind,
    rewardAmount: input.outcome.rewardCoins,
    success: input.outcome.ok,
    reason: input.outcome.message,
  });

  if (input.outcome.ok) {
    const acc = listAccounts().find((a) => a.id === input.accountId);
    if (acc) {
      updateAccount(input.accountId, {
        lifetime_cases: acc.lifetime_cases + input.outcome.rewardCoins,
        status: "idle",
        last_error: null,
      });
    }
    const itemSummary =
      input.outcome.items[0]?.name ??
      (input.outcome.rewardCoins > 0 ? `${input.outcome.rewardCoins.toFixed(2)} coins` : "reward");
    appendLog({
      accountId: input.accountId,
      category: "case",
      message: "Opened case",
      detail: `${input.caseId.slice(0, 8)}… · ${itemSummary}`,
    });
    void notifyCaseWinInUserFeed({
      accountId: input.accountId,
      slotLabel: input.slotLabel ?? "Reward",
      items: input.outcome.items,
      totalCoins: input.outcome.rewardCoins,
    });
    return;
  }

  if (isIgnorableCaseError(input.outcome.message)) {
    appendLog({
      accountId: input.accountId,
      category: "case",
      message: "Skipped case (not auto-opened)",
      detail: input.outcome.message,
    });
    return;
  }

  updateAccount(input.accountId, { status: "error", last_error: input.outcome.message });
  appendLog({
    accountId: input.accountId,
    category: "case",
    message: "Case open failed",
    detail: input.outcome.message,
  });
}
