import type { Client, Guild } from "discord.js";
import { runSetupJoin } from "./friends-user-thread.js";

export const FRIENDS_CONNECT_BUTTON_ID = "friends:connect";

export async function executeConnectForUser(input: {
  client: Client;
  guild: Guild;
  botToken: string;
  discordUserId: string;
  username: string;
  activitySource?: "slash" | "button" | "auto_join";
  activityDisplayName?: string;
}): Promise<{ threadId: string; created: boolean }> {
  return runSetupJoin({
    client: input.client,
    guild: input.guild,
    token: input.botToken,
    discordUserId: input.discordUserId,
    username: input.username,
    activitySource: input.activitySource,
    activityDisplayName: input.activityDisplayName,
  });
}
