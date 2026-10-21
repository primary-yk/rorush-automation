import { getAccount } from "../db/repositories.js";
import type { CaseWonItem } from "../rorush/case-unbox-parse.js";
import { COLORS, formatCoins, withBrand, type RushEmbed } from "./embeds.js";
import { postToUserFeedThread } from "./friends-feed.js";

/** Placeholder image for host drill only (layout preview). */
const SAMPLE_CASE_ITEM_IMAGE = "https://cdn.discordapp.com/emojis/852574441196254230.webp?size=96&quality=lossless";

function primaryItemPrice(item: CaseWonItem | undefined, totalCoins: number): number | null {
  if (item?.priceCoins != null) return item.priceCoins;
  if (totalCoins > 0) return totalCoins;
  return null;
}

export function buildCaseWinFeedEmbed(input: {
  slotLabel: string;
  items: CaseWonItem[];
  totalCoins: number;
  nickname?: string | null;
  sampleNote?: string;
}): RushEmbed {
  const primary = input.items[0];
  const priceCoins = primaryItemPrice(primary, input.totalCoins);
  const isSample = !!input.sampleNote;

  const fields: NonNullable<RushEmbed["fields"]> = [];
  if (primary?.name) {
    fields.push({ name: "Item", value: `**${primary.name}**`, inline: true });
  }
  fields.push({
    name: "Price",
    value: priceCoins != null ? formatCoins(priceCoins) : "—",
    inline: true,
  });
  if (input.nickname) {
    fields.push({ name: "Account", value: `**${input.nickname}**`, inline: true });
  }

  if (input.items.length > 1) {
    const more = input.items
      .slice(1)
      .map((i) => {
        const p = i.priceCoins != null ? ` · ${formatCoins(i.priceCoins)}` : "";
        return `**${i.name}**${p}`;
      })
      .join("\n");
    fields.push({ name: "Also won", value: more.slice(0, 1024), inline: false });
  }

  const title = isSample ? `Cases · ${input.slotLabel} (sample)` : `Cases · ${input.slotLabel}`;
  const descriptionParts: string[] = [];
  if (input.sampleNote) descriptionParts.push(input.sampleNote);
  if (!primary?.name && priceCoins != null) {
    descriptionParts.push(`Total **${formatCoins(priceCoins)}**`);
  }

  const embed: RushEmbed = withBrand(
    {
      title,
      description: descriptionParts.length ? descriptionParts.join("\n\n") : undefined,
      color: COLORS.case,
      fields,
      footer: { text: isSample ? "Cases · sample" : "Cases" },
    },
    COLORS.case,
  );

  const imageUrl = primary?.imageUrl ?? (isSample ? SAMPLE_CASE_ITEM_IMAGE : null);
  if (imageUrl) {
    embed.image = { url: imageUrl };
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
        imageUrl: SAMPLE_CASE_ITEM_IMAGE,
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
