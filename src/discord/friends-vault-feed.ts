import { getAccount } from "../db/repositories.js";
import { COLORS, withBrand, type RushEmbed } from "./embeds.js";
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
  if (input.skippedReason) {
    embed = withBrand(
      {
        title: "Vault · skipped",
        description: `**${account?.nickname ?? "Account"}** — ${input.skippedReason}`,
        color: COLORS.limboSkip,
        footer: { text: "Rain vault" },
      },
      COLORS.limboSkip,
    );
  } else {
    embed = withBrand(
      {
        title: "Vault · rain profit saved",
        description:
          `**${account?.nickname ?? "Account"}** moved **${input.depositedCoins.toFixed(2)} coins** to RoRush vault.\n` +
          `Rain \`${input.rainId.slice(0, 8)}…\``,
        color: COLORS.rainOk,
        footer: { text: "Withdraw on rorush.com when unlocked" },
      },
      COLORS.rainOk,
    );
  }
  await postToUserFeedThread(owner, [embed]);
}
