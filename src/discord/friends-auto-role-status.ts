import type { Guild } from "discord.js";
import {
  serverMembersIntentHelp,
  serverMembersIntentOptedOut,
  useServerMembersIntent,
} from "./friends-member-intent.js";

export type AutoRoleSetupStatus = {
  envEnabled: boolean;
  memberListOk: boolean;
  lines: string[];
};

export async function evaluateAutoRoleForSetup(guild: Guild): Promise<AutoRoleSetupStatus> {
  const envEnabled = useServerMembersIntent();
  if (!envEnabled) {
    const reason = serverMembersIntentOptedOut()
      ? "disabled in `.env` (`DISCORD_SERVER_MEMBERS_INTENT=0`)"
      : "not enabled for this bot mode";
    return {
      envEnabled: false,
      memberListOk: false,
      lines: [
        `**Auto-role on join:** OFF — ${reason}`,
        "Remove `DISCORD_SERVER_MEMBERS_INTENT=0`, enable **Server Members Intent** in the Developer Portal, restart `npm run dev`.",
        "Until then, friends get **Rain Member** when they run **`/connect`**.",
      ],
    };
  }

  let memberListOk = false;
  let fetchHint = "";
  try {
    await guild.members.fetch({ limit: 1 });
    memberListOk = true;
  } catch (err) {
    memberListOk = false;
    fetchHint = err instanceof Error ? err.message : String(err);
  }

  if (!memberListOk) {
    return {
      envEnabled: true,
      memberListOk: false,
      lines: [
        "**Auto-role on join:** waiting on bot restart",
        "Server Members Intent is enabled in the Portal, but this running bot cannot read members yet.",
        serverMembersIntentHelp(),
        fetchHint ? `Detail: \`${fetchHint.slice(0, 120)}\`` : "",
      ].filter(Boolean),
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
