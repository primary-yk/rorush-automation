import type { SlashCommandStringOption } from "@discordjs/builders";
import { VAULT_LOCK_PRESETS, type VaultLockPresetId } from "../rorush/vault-lock.js";

const DURATION_LABELS: Record<VaultLockPresetId, string> = {
  "10m": "10 minutes",
  "30m": "30 minutes",
  "1h": "1 hour",
  "6h": "6 hours",
  "12h": "12 hours",
  "1d": "1 day",
};

/** Slash string option — pick one of the member's saved accounts (autocomplete dropdown). */
export function savedAccountOption(
  option: SlashCommandStringOption,
  input?: { name?: "account" | "nickname"; required?: boolean; description?: string },
): SlashCommandStringOption {
  const name = input?.name ?? "account";
  return option
    .setName(name)
    .setDescription(input?.description ?? "Pick your saved account")
    .setRequired(input?.required ?? true)
    .setAutocomplete(true);
}

export const VAULT_LOCK_SLASH_CHOICES = [
  { name: "No timed lock", value: "off" },
  ...(Object.keys(VAULT_LOCK_PRESETS) as VaultLockPresetId[]).map((id) => ({
    name: DURATION_LABELS[id],
    value: id,
  })),
];

/** Duration + optional rain-vault for `/rorush vault`. */
export function vaultLockDurationOption(option: SlashCommandStringOption): SlashCommandStringOption {
  let o = option
    .setName("duration")
    .setDescription("How long withdraw stays blocked on RoRush")
    .setRequired(false);
  for (const choice of VAULT_LOCK_SLASH_CHOICES) {
    o = o.addChoices(choice);
  }
  return o;
}

export function vaultRainDuringLockOption(
  option: import("@discordjs/builders").SlashCommandBooleanOption,
): import("@discordjs/builders").SlashCommandBooleanOption {
  return option
    .setName("vault_rain")
    .setDescription("While locked, auto-vault rain profit (withdraw still blocked until timer ends)")
    .setRequired(false);
}
