import type { Guild } from "discord.js";
import { serverMembersIntentHelp, useServerMembersIntent } from "./friends-member-intent.js";

export type AutoRoleSetupStatus = {
  envEnabled: boolean;
  memberListOk: boolean;
  lines: string[];
};

export async function evaluateAutoRoleForSetup(guild: Guild): Promise<AutoRoleSetupStatus> {
  const envEnabled = useServerMembersIntent();
  if (!envEnabled) {
    return {
      envEnabled: false,
      memberListOk: false,
      lines: [
        "**Auto-role on join:** OFF",
        "Set `DISCORD_SERVER_MEMBERS_INTENT=1` and enable **Server Members Intent** in the Developer Portal, then restart the bot.",
        "Until then, friends get **Rain Member** when they run **`/connect`**.",
      ],
    };
  }

  let memberListOk = false;
  try {
    await guild.members.fetch({ limit: 1 });
    memberListOk = true;
  } catch {
    memberListOk = false;
  }

  if (!memberListOk) {
    return {
      envEnabled: true,
      memberListOk: false,
      lines: [
        "**Auto-role on join:** misconfigured",
        "`DISCORD_SERVER_MEMBERS_INTENT=1` is set but the bot cannot read members.",
        serverMembersIntentHelp(),
      ],
    };
  }

  return {
    envEnabled: true,
    memberListOk: true,
    lines: [
      "**Auto-role on join:** ON — new server members receive **Rain Member** automatically.",
      "Existing members are synced each time you run **`/server setup`**.",
    ],
  };
}
