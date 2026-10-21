import type { AutocompleteInteraction } from "discord.js";
import { listAccounts } from "../db/repositories.js";
import { accountsForDiscordUser } from "./friends-commands.js";

const ACCOUNT_OPTION_NAMES = new Set(["account", "nickname"]);

export function accountNicknameAutocompleteChoices(input: {
  discordUserId: string;
  focusedValue: string;
  includeAllHostAccounts: boolean;
}): Array<{ name: string; value: string }> {
  const pool = input.includeAllHostAccounts
    ? listAccounts()
    : accountsForDiscordUser(input.discordUserId);
  const q = input.focusedValue.trim().toLowerCase();
  return pool
    .filter((a) => !q || a.nickname.toLowerCase().includes(q))
    .slice(0, 25)
    .map((a) => ({ name: a.nickname, value: a.nickname }));
}

function hostMayPickAnyAccount(interaction: AutocompleteInteraction, isHost: boolean): boolean {
  if (!isHost) return false;
  if (interaction.commandName !== "account") return false;
  const sub = interaction.options.getSubcommand(false);
  return sub === "pause" || sub === "resume";
}

export async function handleFriendsSlashAutocomplete(
  interaction: AutocompleteInteraction,
  isHost: (userId: string) => boolean,
): Promise<void> {
  const focused = interaction.options.getFocused(true);
  if (focused.type !== 3 || !ACCOUNT_OPTION_NAMES.has(focused.name)) {
    await interaction.respond([]).catch(() => undefined);
    return;
  }
  const choices = accountNicknameAutocompleteChoices({
    discordUserId: interaction.user.id,
    focusedValue: String(focused.value ?? ""),
    includeAllHostAccounts: hostMayPickAnyAccount(interaction, isHost(interaction.user.id)),
  });
  await interaction.respond(choices).catch(() => undefined);
}
