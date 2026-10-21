import { REST, Routes, type Guild, type GuildMember } from "discord.js";
import { getSettings } from "../db/repositories.js";
import { parseFriendsServerLayout } from "./friends-layout.js";
import { useServerMembersIntent } from "./friends-member-intent.js";

export function memberRoleIdFromLayout(): string | null {
  const layout = parseFriendsServerLayout(getSettings().discord_server_layout_json);
  return layout?.roleIds.pilot?.trim() ?? null;
}

export async function addGuildMemberRole(input: {
  token: string;
  guildId: string;
  userId: string;
  roleId: string;
}): Promise<void> {
  const rest = new REST({ version: "10" }).setToken(input.token);
  await rest.put(Routes.guildMemberRole(input.guildId, input.userId, input.roleId));
}

export async function ensureMemberRoleOnMember(input: {
  member: GuildMember;
  botToken: string;
  hostUserId?: string | null;
}): Promise<boolean> {
  const roleId = memberRoleIdFromLayout();
  if (!roleId || input.member.user.bot) return false;
  if (input.hostUserId && input.member.id === input.hostUserId) {
    /* staff role covers access; member role optional for host */
  }
  if (input.member.roles.cache.has(roleId)) return false;
  await addGuildMemberRole({
    token: input.botToken,
    guildId: input.member.guild.id,
    userId: input.member.id,
    roleId,
  });
  return true;
}

/** Grant Rain Member to every non-bot in guild (run after /server setup). */
export async function syncMemberRoleForAllMembers(input: {
  guild: Guild;
  botToken: string;
  hostUserId: string;
}): Promise<number> {
  const roleId = memberRoleIdFromLayout();
  if (!roleId) return 0;
  if (!useServerMembersIntent()) {
    console.log(
      "[friends-bot] skipped bulk Rain Member sync — enable Server Members Intent in Developer Portal and restart (or remove DISCORD_SERVER_MEMBERS_INTENT=0).",
    );
    return 0;
  }
  await input.guild.members.fetch();
  let added = 0;
  for (const member of input.guild.members.cache.values()) {
    if (member.user.bot) continue;
    const ok = await ensureMemberRoleOnMember({
      member,
      botToken: input.botToken,
      hostUserId: input.hostUserId,
    }).catch(() => false);
    if (ok) added += 1;
  }
  return added;
}
