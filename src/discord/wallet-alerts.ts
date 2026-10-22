import { updateAccount } from "../db/repositories.js";
import type { RoRushHttpClient } from "../rorush/http-client.js";
import {
  correctFunCoinWalletIfNeeded,
  type FunCoinCorrectReason,
  type RorushBalanceToken,
} from "../rorush/balance-token.js";
import { reportFunCoinWalletCorrected } from "./reporter.js";

export async function runFunCoinWalletCorrection(input: {
  client: RoRushHttpClient;
  reason: FunCoinCorrectReason;
  accountId: number;
  nickname: string;
}): Promise<{
  switched: boolean;
  before: RorushBalanceToken | null;
  after: RorushBalanceToken | null;
}> {
  const result = await correctFunCoinWalletIfNeeded(input.client, input.reason, {
    accountId: input.accountId,
    nickname: input.nickname,
  });

  const tokenPatch = result.after ?? result.before;
  if (tokenPatch != null) {
    updateAccount(input.accountId, { wallet_balance_token: tokenPatch });
  }

  if (result.switched) {
    void reportFunCoinWalletCorrected({
      nickname: input.nickname,
      accountId: input.accountId,
      before: result.before,
      reason: input.reason,
    });
  }

  return result;
}
