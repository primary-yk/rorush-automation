import { PermissionFlagsBits } from "discord.js";

/** Block @everyone from seeing or posting in managed areas. */
export const LOCK_EVERYONE_DENY: bigint[] = [
  PermissionFlagsBits.ViewChannel,
  PermissionFlagsBits.SendMessages,
  PermissionFlagsBits.Connect,
  PermissionFlagsBits.Speak,
  PermissionFlagsBits.Stream,
  PermissionFlagsBits.CreatePublicThreads,
  PermissionFlagsBits.CreatePrivateThreads,
  PermissionFlagsBits.SendMessagesInThreads,
  PermissionFlagsBits.AttachFiles,
  PermissionFlagsBits.EmbedLinks,
];

/** @everyone can read INFO before they have Rain Member (so they can run `/connect`). */
export const EVERYONE_INFO_ALLOW: bigint[] = [
  PermissionFlagsBits.ViewChannel,
  PermissionFlagsBits.ReadMessageHistory,
];

export const EVERYONE_INFO_DENY: bigint[] = [
  PermissionFlagsBits.SendMessages,
  PermissionFlagsBits.SendMessagesInThreads,
  PermissionFlagsBits.CreatePublicThreads,
  PermissionFlagsBits.CreatePrivateThreads,
  PermissionFlagsBits.AddReactions,
  PermissionFlagsBits.ManageThreads,
  PermissionFlagsBits.AttachFiles,
];

/** Read-only info channels for Rain Member. */
export const MEMBER_INFO_DENY: bigint[] = [
  PermissionFlagsBits.SendMessages,
  PermissionFlagsBits.SendMessagesInThreads,
  PermissionFlagsBits.CreatePublicThreads,
  PermissionFlagsBits.CreatePrivateThreads,
  PermissionFlagsBits.AddReactions,
  PermissionFlagsBits.ManageThreads,
];

/** #rain-feeds hub: threads only, no posting in the parent channel. */
export const MEMBER_FEEDS_DENY: bigint[] = [
  PermissionFlagsBits.SendMessages,
  PermissionFlagsBits.CreatePublicThreads,
  PermissionFlagsBits.AddReactions,
];
