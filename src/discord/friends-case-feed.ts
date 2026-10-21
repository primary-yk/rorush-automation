import { getAccount } from "../db/repositories.js";
import type { CaseWonItem } from "../rorush/case-unbox-parse.js";
import { COLORS, withBrand, type RushEmbed } from "./embeds.js";
import { postToUserFeedThread } from "./friends-feed.js";

export function buildCaseWinFeedEmbed(input: {
  slotLabel: string;
  items: CaseWonItem[];
  totalCoins: number;
  nickname?: string | null;
  sampleNote?: string;
}): RushEmbed {
  const primary = input.items[0];
  const lines: string[] = [];
  if (input.sampleNote) {
    lines.push(input.sampleNote);
  }
  if (primary) {
    lines.push(`**${primary.name}**`);
    if (primary.priceCoins != null) lines.push(`Value **${primary.priceCoins.toFixed(2)} coins**`);
  } else if (input.totalCoins > 0) {
    lines.push(`Total **${input.totalCoins.toFixed(2)} coins**`);
  }
  if (input.items.length > 1) {
    lines.push(`+ ${input.items.length - 1} more item(s)`);
  }

  const title = input.sampleNote ? `Cases · ${input.slotLabel} (sample)` : `Cases · ${input.slotLabel}`;
  const embed: RushEmbed = withBrand(
    {
      title,
      description: lines.filter(Boolean).join("\n") || "Reward case opened successfully.",
      color: COLORS.case,
      fields: input.nickname
        ? [{ name: "Account", value: `**${input.nickname}**`, inline: true }]
        : undefined,
      footer: { text: input.sampleNote ? "Cases · sample" : "Cases" },
    },
    COLORS.case,
  );

  if (primary?.imageUrl) {
    embed.image = { url: primary.imageUrl };
  }

  return embed;
}

export function buildSampleDailyCaseEmbed(nickname: string): RushEmbed {
  return buildCaseWinFeedEmbed({
    slotLabel: "Daily",
    nickname,
    totalCoins: 12.5,
    sampleNote: "_Host test only — not a real case open._",
    items: [
      {
        name: "Sample reward (daily case)",
        priceCoins: 12.5,
        imageUrl: null,
      },
    ],
  });
}

export async function notifyCaseWinInUserFeed(input: {
  accountId: number;
  slotLabel: string;
  items: CaseWonItem[];
  totalCoins: number;
}): Promise<void> {
  const account = getAccount(input.accountId);
  const owner = account?.owner_discord_id?.trim();
  if (!owner) return;

  const embed = buildCaseWinFeedEmbed({
    slotLabel: input.slotLabel,
    items: input.items,
    totalCoins: input.totalCoins,
    nickname: account?.nickname,
  });

  await postToUserFeedThread(owner, [embed]);
}
