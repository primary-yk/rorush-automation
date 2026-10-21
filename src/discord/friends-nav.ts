import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  type MessageActionRowComponentBuilder,
} from "discord.js";

export const NAV_PREFIX = "friends:nav:";

export function isNavComponent(customId: string): boolean {
  return customId.startsWith(NAV_PREFIX);
}

export function buildGlobalNavRow(): ActionRowBuilder<MessageActionRowComponentBuilder> {
  return new ActionRowBuilder<MessageActionRowComponentBuilder>().addComponents(
    new ButtonBuilder()
      .setCustomId(`${NAV_PREFIX}dashboard`)
      .setLabel("Dashboard")
      .setStyle(ButtonStyle.Primary),
    new ButtonBuilder()
      .setCustomId(`${NAV_PREFIX}earnings`)
      .setLabel("Earnings")
      .setStyle(ButtonStyle.Secondary),
    new ButtonBuilder()
      .setCustomId(`${NAV_PREFIX}guide`)
      .setLabel("Guide")
      .setStyle(ButtonStyle.Secondary),
    new ButtonBuilder()
      .setCustomId(`${NAV_PREFIX}help`)
      .setLabel("All commands")
      .setStyle(ButtonStyle.Secondary),
    new ButtonBuilder()
      .setCustomId(`${NAV_PREFIX}status`)
      .setLabel("Status")
      .setStyle(ButtonStyle.Secondary),
  );
}

export function prependNavRow(
  rows: ActionRowBuilder<MessageActionRowComponentBuilder>[],
): ActionRowBuilder<MessageActionRowComponentBuilder>[] {
  return [buildGlobalNavRow(), ...rows].slice(0, 5);
}
