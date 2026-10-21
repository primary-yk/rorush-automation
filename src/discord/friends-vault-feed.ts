import { getAccount } from "../db/repositories.js";
import { COLORS, formatCoins, shortRainId, withBrand, type RushEmbed } from "./embeds.js";
import { postToUserFeedThread } from "./friends-feed.js";

export async function notifyVaultDepositInUserFeed(input: {
  accountId: number;
  depositedCoins: number;
  rainId: string;
  skippedReason?: string;
}): Promise<void> {
  const account = getAccount(input.accountId);
  const owner = account?.owner_discord_id?.trim();
  if (!owner) return;

  let embed: RushEmbed;
  const nick = account?.nickname ?? "Account";
  if (input.skippedReason) {
    embed = withBrand(
      {
        title: "Vault · Skipped",
        description: input.skippedReason,
        color: COLORS.limboSkip,
        fields: [{ name: "Account", value: `**${nick}**`, inline: true }],
        footer: { text: "Vault" },
      },
      COLORS.limboSkip,
    );
  } else {
    embed = withBrand(
      {
        title: "Vault · Deposit",
        description: `Rain profit moved to your RoRush vault.`,
        color: COLORS.rainOk,
        fields: [
          { name: "Account", value: `**${nick}**`, inline: true },
          { name: "Amount", value: formatCoins(input.depositedCoins), inline: true },
          { name: "Rain ID", value: shortRainId(input.rainId), inline: true },
        ],
        footer: { text: "Withdraw on rorush.com when unlocked" },
      },
      COLORS.rainOk,
    );
  }
  await postToUserFeedThread(owner, [embed]);
}
