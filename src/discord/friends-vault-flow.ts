import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  type ButtonInteraction,
} from "discord.js";
import { startVaultSession } from "../automation/vault-lock-apply.js";
import { findOwnedAccount } from "./friends-vault-flow-account.js";
import { VAULT_LOCK_PRESETS, type VaultLockPresetId } from "../rorush/vault-lock.js";
import { buildPlainResultEmbed, buildErrorEmbed } from "./friends-ui.js";
import { replyEphemeralEmbed } from "./friends-interaction.js";

export const FRIENDS_VAULT_OPEN = "friends:vault:open";

const DUR_PREFIX = "friends:vault:dur:";
const CONFIRM_PREFIX = "friends:vault:confirm:";

export function isVaultFlowButton(id: string): boolean {
  return id === FRIENDS_VAULT_OPEN || id.startsWith(DUR_PREFIX) || id.startsWith(CONFIRM_PREFIX);
}

const DURATION_LABELS: Record<VaultLockPresetId, string> = {
  "10m": "10 minutes",
  "30m": "30 minutes",
  "1h": "1 hour",
  "6h": "6 hours",
  "12h": "12 hours",
  "1d": "1 day",
};

export function buildRorushVaultStartEmbed(nickname: string) {
  return buildPlainResultEmbed(
    [
      `**RoRush vault · ${nickname}**`,
      "",
      "1. Pick **how long** withdraw stays blocked on RoRush.",
      "2. Choose whether **rain profits** auto-move to vault **only for that timer**.",
      "",
      "When the timer ends, nothing re-locks until you run **`/rorush vault`** again.",
    ].join("\n"),
    true,
  );
}

export function buildRorushVaultDurationRows(accountId: number): ActionRowBuilder<ButtonBuilder>[] {
  const presets = Object.keys(VAULT_LOCK_PRESETS) as VaultLockPresetId[];
  const row1 = new ActionRowBuilder<ButtonBuilder>();
  const row2 = new ActionRowBuilder<ButtonBuilder>();
  for (const id of presets.slice(0, 3)) {
    row1.addComponents(
      new ButtonBuilder()
        .setCustomId(`${DUR_PREFIX}${id}:${accountId}`)
        .setLabel(DURATION_LABELS[id])
        .setStyle(ButtonStyle.Primary),
    );
  }
  for (const id of presets.slice(3)) {
    row2.addComponents(
      new ButtonBuilder()
        .setCustomId(`${DUR_PREFIX}${id}:${accountId}`)
        .setLabel(DURATION_LABELS[id])
        .setStyle(ButtonStyle.Secondary),
    );
  }
  return [row1, row2];
}

function parseDurButton(customId: string): { preset: VaultLockPresetId; accountId: number } | null {
  if (!customId.startsWith(DUR_PREFIX)) return null;
  const rest = customId.slice(DUR_PREFIX.length);
  const idx = rest.lastIndexOf(":");
  if (idx <= 0) return null;
  const preset = rest.slice(0, idx) as VaultLockPresetId;
  const accountId = Number(rest.slice(idx + 1));
  if (!VAULT_LOCK_PRESETS[preset] || !Number.isFinite(accountId)) return null;
  return { preset, accountId };
}

function parseConfirmButton(
  customId: string,
): { vaultRain: boolean; preset: VaultLockPresetId; accountId: number } | null {
  if (!customId.startsWith(CONFIRM_PREFIX)) return null;
  const rest = customId.slice(CONFIRM_PREFIX.length);
  const parts = rest.split(":");
  if (parts.length !== 3) return null;
  const [yesNo, preset, accountIdStr] = parts;
  if (yesNo !== "yes" && yesNo !== "no") return null;
  const presetId = preset as VaultLockPresetId;
  const accountId = Number(accountIdStr);
  if (!VAULT_LOCK_PRESETS[presetId] || !Number.isFinite(accountId)) return null;
  return { vaultRain: yesNo === "yes", preset: presetId, accountId };
}

export async function handleVaultFlowButton(
  interaction: ButtonInteraction,
  discordUserId: string,
): Promise<void> {
  const id = interaction.customId;

  if (id === FRIENDS_VAULT_OPEN) {
    await interaction.reply({
      ephemeral: true,
      content: "Pick an account: **`/rorush vault account:YourNickname`**",
    });
    return;
  }

  const dur = parseDurButton(id);
  if (dur) {
    const owned = findOwnedAccount(discordUserId, dur.accountId);
    if (!owned) {
      await interaction.reply({ ephemeral: true, content: "That account is not yours." });
      return;
    }
    const label = DURATION_LABELS[dur.preset];
    const row = new ActionRowBuilder<ButtonBuilder>().addComponents(
      new ButtonBuilder()
        .setCustomId(`${CONFIRM_PREFIX}yes:${dur.preset}:${dur.accountId}`)
        .setLabel("Lock + vault rain profits")
        .setStyle(ButtonStyle.Success),
      new ButtonBuilder()
        .setCustomId(`${CONFIRM_PREFIX}no:${dur.preset}:${dur.accountId}`)
        .setLabel("Lock only (no auto vault)")
        .setStyle(ButtonStyle.Secondary),
    );
    await interaction.update({
      embeds: [
        buildPlainResultEmbed(
          [
            `**${owned.nickname}** · **${label}**`,
            "",
            "**Lock + vault rain profits** — withdraw blocked; each joined rain sends profit to vault **until the timer ends**.",
            "",
            "**Lock only** — timer on RoRush; rain stays in your wallet unless you pick vault later.",
          ].join("\n"),
          true,
        ),
      ],
      components: [row],
    });
    return;
  }

  const confirm = parseConfirmButton(id);
  if (confirm) {
    const owned = findOwnedAccount(discordUserId, confirm.accountId);
    if (!owned) {
      await interaction.reply({ ephemeral: true, content: "That account is not yours." });
      return;
    }
    await interaction.deferUpdate();
    const minutes = VAULT_LOCK_PRESETS[confirm.preset];
    try {
      const text = await startVaultSession({
        accountId: owned.id,
        lockMinutes: minutes,
        vaultRainDuringLock: confirm.vaultRain,
      });
      await interaction.editReply({ embeds: [buildPlainResultEmbed(text, true)], components: [] });
    } catch (err) {
      await replyEphemeralEmbed(
        interaction,
        buildErrorEmbed(err instanceof Error ? err.message : String(err)),
      );
    }
  }
}
