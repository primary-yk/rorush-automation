import { getAccount } from "../db/repositories.js";
import type { CaseWonItem } from "../rorush/case-unbox-parse.js";
import { COLORS, withBrand, type RushEmbed } from "./embeds.js";
import { postToUserFeedThread } from "./friends-feed.js";

export async function notifyCaseWinInUserFeed(input: {
  accountId: number;
  slotLabel: string;
  items: CaseWonItem[];
  totalCoins: number;
}): Promise<void> {
  const account = getAccount(input.accountId);
  const owner = account?.owner_discord_id?.trim();
  if (!owner) return;

  const primary = input.items[0];
  const lines: string[] = [];
  if (primary) {
    lines.push(`**${primary.name}**`);
    if (primary.priceCoins != null) lines.push(`Value **${primary.priceCoins.toFixed(2)} coins**`);
  } else if (input.totalCoins > 0) {
    lines.push(`Total **${input.totalCoins.toFixed(2)} coins**`);
  }
  if (input.items.length > 1) {
    lines.push(`+ ${input.items.length - 1} more item(s)`);
  }

  const embed: RushEmbed = withBrand(
    {
      title: `Cases · ${input.slotLabel}`,
      description: lines.join("\n") || "Reward case opened successfully.",
      color: COLORS.case,
      fields: account?.nickname
        ? [{ name: "Account", value: `**${account.nickname}**`, inline: true }]
        : undefined,
      footer: { text: "Cases" },
    },
    COLORS.case,
  );

  if (primary?.imageUrl) {
    embed.image = { url: primary.imageUrl };
  }

  await postToUserFeedThread(owner, [embed]);
}
