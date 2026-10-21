import { postToHostLogChannel } from "./friends-feed.js";
import { tagHostEmbed } from "./host-log-classify.js";

export type HostMemberActivityKind =
  | "feed_open"
  | "account_add"
  | "account_session"
  | "account_remove";

export async function logHostMemberActivity(input: {
  kind: HostMemberActivityKind;
  discordUserId: string;
  displayName: string;
  detail?: string;
  threadId?: string;
  created?: boolean;
}): Promise<void> {
  const titles: Record<HostMemberActivityKind, string> = {
    feed_open: "Private feed",
    account_add: "Account linked",
    account_session: "Session account linked",
    account_remove: "Account removed",
  };
  const lines = [
    `<@${input.discordUserId}> · **${input.displayName}**`,
    input.threadId
      ? input.created
        ? `Created <#${input.threadId}>`
        : `Using <#${input.threadId}>`
      : null,
    input.detail ? input.detail : null,
  ].filter(Boolean);
  await postToHostLogChannel([
    tagHostEmbed({
      title: titles[input.kind],
      description: lines.join("\n"),
      color: input.kind === "feed_open" ? 0x06_b6_d4 : 0x8b_5c_f6,
    }),
  ]);
}
