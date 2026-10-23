import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  type Client,
} from "discord.js";
import { getDiscordUserThread } from "../db/repositories.js";

export const MINES_BOARD_PREFIX = "mines:tile:";

let clientRef: Client | null = null;

export function bindMinesBoardClient(client: Client | null): void {
  clientRef = client;
}

function tileEmoji(revealed: Set<number>, index: number): string {
  return revealed.has(index) ? "💎" : "⬜";
}

function buildRows(revealed: Set<number>, accountId: number, disabled: boolean): ActionRowBuilder<ButtonBuilder>[] {
  const rows: ActionRowBuilder<ButtonBuilder>[] = [];
  for (let row = 0; row < 5; row++) {
    const actionRow = new ActionRowBuilder<ButtonBuilder>();
    for (let col = 0; col < 5; col++) {
      const index = row * 5 + col;
      actionRow.addComponents(
        new ButtonBuilder()
          .setCustomId(`${MINES_BOARD_PREFIX}${accountId}:${index}`)
          .setLabel(String(index + 1))
          .setEmoji(tileEmoji(revealed, index))
          .setStyle(revealed.has(index) ? ButtonStyle.Secondary : ButtonStyle.Primary)
          .setDisabled(disabled || revealed.has(index)),
      );
    }
    rows.push(actionRow);
  }
  return rows;
}

export async function postMinesBoardToOwner(input: {
  ownerDiscordId: string | null;
  accountId: number;
  nickname: string;
  betCoins: number;
  minesCount: number;
  targetMultiplier: number;
  revealed: Set<number>;
  status: string;
}): Promise<boolean> {
  const client = clientRef;
  if (!client || !input.ownerDiscordId?.trim()) return false;
  const row = getDiscordUserThread(input.ownerDiscordId.trim());
  if (!row?.thread_id) return false;
  const ch = await client.channels.fetch(row.thread_id).catch(() => null);
  if (!ch?.isTextBased()) return false;

  const content =
    `**Mines · ${input.nickname}** · bet **${input.betCoins.toFixed(2)}** coins · **${input.minesCount}** mines · target **${input.targetMultiplier.toFixed(2)}×**\n` +
    `${input.status}`;

  try {
    if (!("send" in ch) || typeof ch.send !== "function") return false;
    await ch.send({
      content,
      components: buildRows(input.revealed, input.accountId, false),
    });
    return true;
  } catch {
    return false;
  }
}

export async function updateMinesBoardMessage(input: {
  channelId: string;
  messageId: string;
  accountId: number;
  revealed: Set<number>;
  statusLine: string;
  disabled?: boolean;
}): Promise<void> {
  const client = clientRef;
  if (!client) return;
  const ch = await client.channels.fetch(input.channelId).catch(() => null);
  if (!ch?.isTextBased()) return;
  const msg = await ch.messages.fetch(input.messageId).catch(() => null);
  if (!msg) return;
  await msg.edit({
    content: input.statusLine,
    components: buildRows(input.revealed, input.accountId, input.disabled ?? false),
  });
}

export function parseMinesTileCustomId(customId: string): { accountId: number; tile: number } | null {
  if (!customId.startsWith(MINES_BOARD_PREFIX)) return null;
  const rest = customId.slice(MINES_BOARD_PREFIX.length);
  const [idRaw, tileRaw] = rest.split(":");
  const accountId = Number(idRaw);
  const tile = Number(tileRaw);
  if (!Number.isFinite(accountId) || !Number.isFinite(tile)) return null;
  return { accountId, tile };
}
