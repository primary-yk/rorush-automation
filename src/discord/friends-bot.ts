import {
  ActivityType,
  Client,
  Events,
  GatewayIntentBits,
  REST,
  Routes,
  SlashCommandBuilder,
  AttachmentBuilder,
  type ButtonInteraction,
  type ChatInputCommandInteraction,
  type EmbedBuilder,
} from "discord.js";
import { effectiveLimboMinBetCoins, LIMBO_MIN_MULTIPLIER } from "../config.js";
import { getSettings, updateSettings } from "../db/repositories.js";
import {
  activateDiscordSeat,
  discordSeatStatus,
  isDiscordSeatActive,
  isHostedSaasMode,
} from "../license/discord-seat.js";
import { issueLicenseKey } from "../license/issue.js";
import { getLicenseStatus } from "../license/service.js";
import {
  accountsForDiscordUser,
  addAccountForDiscordUser,
  addAccountSessionForDiscordUser,
  refreshAccountsForDiscordUser,
  findOwnedAccount,
  setAccountAutomationPaused,
  setAutoVaultDeposit,
  setLimbo,
  setRainFilters,
  setToggle,
  testLimboForDiscordUser,
} from "./friends-commands.js";
import { bindFriendsFeedClient, notifyStaffSlashError } from "./friends-feed.js";
import { bindMinesBoardClient, MINES_BOARD_PREFIX } from "./mines-board.js";
import { handleMinesTileButton } from "./mines-interaction.js";
import {
  minesStatusForUser,
  setMinesAutoForUser,
  stopMinesAutoForUser,
  testMinesForDiscordUser,
} from "./mines-commands.js";
import { runFriendsServerSetup } from "./friends-server-setup.js";
import { autoConnectFeedOnJoin } from "./friends-auto-connect.js";
import { executeConnectForUser, FRIENDS_CONNECT_BUTTON_ID } from "./friends-connect.js";
import { logHostMemberActivity } from "./friends-host-activity.js";
import { FRIENDS_HOST_BUTTON_IDS, handleHostToolButton } from "./friends-host-tools.js";
import { hostJumpToUserFeedThread, restoreUserFeedThread, runSetupJoin } from "./friends-user-thread.js";
import { botWatchingPresenceName } from "./friends-branding.js";
import { isFriendsHostMode } from "./host-alerts.js";
import { discordSupportLine } from "./friends-copy.js";
import { ensureMemberRoleOnMember } from "./friends-guild-roles.js";
import { parseFriendsServerLayout } from "./friends-layout.js";
import { serverMembersIntentHelp, useServerMembersIntent } from "./friends-member-intent.js";
import { appendSessionHintIfNeeded } from "./friends-auth-hints.js";
import {
  deferEphemeral,
  isInteractionAlreadyAcknowledged,
  replyEphemeralEmbed,
  replyEphemeralEmbeds,
} from "./friends-interaction.js";
import { botRuntimeLabel, encryptionKeyStatus, projectRoot } from "../config.js";
import { sanitizeDiscordOutbound } from "./sanitize-outbound.js";
import { engine } from "../worker/engine.js";
import { handleVaultFlowButton, isVaultFlowButton } from "./friends-vault-flow.js";
import {
  buildAccountDashboardView,
  handleDashboardInteraction,
  isDashboardComponent,
} from "./friends-dashboard.js";
import {
  buildGlobalNavRow,
  buildReplyComponentRows,
  handleNavInteraction,
  isNavComponent,
  prependNavRow,
} from "./friends-quick-actions.js";
import { handleFriendsSlashAutocomplete } from "./friends-slash-autocomplete.js";
import {
  savedAccountOption,
  vaultLockDurationOption,
  vaultRainDuringLockOption,
} from "./friends-slash-options.js";
import { parseVaultLockPreset } from "../rorush/vault-lock.js";
import { clearAllVaultPreferences, startVaultSession } from "../automation/vault-lock-apply.js";
import {
  buildRemoveAccountConfirmRow,
  handleRemoveAccountButton,
  isRemoveConfirmButton,
} from "./friends-account-remove.js";
import { writeHostBackupFile } from "./friends-owner-backup.js";
import {
  buildErrorEmbed,
  buildHelpEmbed,
  buildPersonalEarningsEmbed,
  buildServerEarningsBoardEmbed,
  buildPlainResultEmbed,
  inferResultEmbedTitle,
  buildSetupGuideEmbed,
  buildSetupJoinEmbed,
  buildSetupServerEmbed,
  buildStatusEmbed,
  buildHostJumpEmbed,
  buildThreadRestoreEmbed,
  buildUpdateEmbed,
} from "./friends-ui.js";

function out(text: string): string {
  return sanitizeDiscordOutbound(text);
}

async function replyEmbeds(
  interaction: ChatInputCommandInteraction,
  embeds: EmbedBuilder[],
  withNav = true,
): Promise<void> {
  const components = withNav ? [buildGlobalNavRow()] : undefined;
  await replyEphemeralEmbeds(interaction, embeds, components);
}

async function editEmbeds(
  interaction: ChatInputCommandInteraction | ButtonInteraction,
  embed: EmbedBuilder,
): Promise<void> {
  await replyEphemeralEmbed(interaction, embed);
}

function resultEmbed(text: string): EmbedBuilder {
  const body = out(appendSessionHintIfNeeded(text));
  const fail =
    /no account|not saved|required|must be|license|host-only|invalid|expired|incomplete|could not verify|failed|refresh failed|not linked|could not complete|already taken|looks incomplete/i.test(
      body,
    );
  const ok = !fail;
  return buildPlainResultEmbed(body, ok, inferResultEmbedTitle(body, ok));
}

async function replyWithResult(
  interaction: ChatInputCommandInteraction,
  text: string,
  options?: { accountNickname?: string; fullControls?: boolean },
): Promise<void> {
  const embed = resultEmbed(text);
  const components = buildReplyComponentRows(interaction.user.id, {
    accountNickname: options?.accountNickname,
    includeAccountControls: options?.fullControls ?? true,
  });
  await replyEphemeralEmbeds(interaction, [embed], components);
}

let client: Client | null = null;

function buildSlashCommands() {
  const core = [
  new SlashCommandBuilder()
    .setName("connect")
    .setDescription("Create or open your private automation feed thread"),
  new SlashCommandBuilder()
    .setName("guide")
    .setDescription("Step-by-step setup — feed, login, automation"),
  new SlashCommandBuilder()
    .setName("server")
    .setDescription("Staff: Discord server layout")
    .addSubcommand((sub) =>
      sub
        .setName("setup")
        .setDescription("Replace bot channels/categories; repair roles & permissions")
        .addBooleanOption((o) =>
          o
            .setName("confirm")
            .setDescription("Set true to replace an existing bot layout (deletes old channels/threads)"),
        ),
    )
    .addSubcommand((sub) =>
      sub.setName("earnings").setDescription("Lifetime earnings for every linked Discord member"),
    )
    .addSubcommand((sub) =>
      sub.setName("tools").setDescription("Re-post host test buttons in #host-log"),
    ),
  new SlashCommandBuilder().setName("help").setDescription("Command reference with quick navigation"),
  new SlashCommandBuilder()
    .setName("earnings")
    .setDescription("Lifetime rain, cases, and code totals for your accounts"),
  new SlashCommandBuilder().setName("status").setDescription("Engine health and host account counts"),
  new SlashCommandBuilder()
    .setName("dashboard")
    .setDescription("Account overview with rain, cases, and limbo buttons"),
  new SlashCommandBuilder()
    .setName("jump")
    .setDescription("Staff: join a member's private feed thread for support")
    .addUserOption((o) => o.setName("member").setDescription("Whose feed to open").setRequired(true)),
  new SlashCommandBuilder()
    .setName("thread")
    .setDescription("Staff: private feed thread tools")
    .addSubcommand((sub) =>
      sub
        .setName("restore")
        .setDescription("Re-add a member to their private feed thread")
        .addUserOption((o) => o.setName("member").setDescription("Member to restore").setRequired(true)),
    ),
  new SlashCommandBuilder()
    .setName("account")
    .setDescription("Link and manage RoRush accounts (private replies)")
    .addSubcommand((sub) =>
      sub
        .setName("add")
        .setDescription("Standard login — email and password")
        .addStringOption((o) => o.setName("nickname").setDescription("Label, e.g. Main").setRequired(true))
        .addStringOption((o) => o.setName("email").setDescription("Login email").setRequired(true))
        .addStringOption((o) => o.setName("password").setDescription("Login password").setRequired(true)),
    )
    .addSubcommand((sub) =>
      sub
        .setName("session")
        .setDescription("Advanced — session JWT from rorush.com (2FA-friendly)")
        .addStringOption((o) => o.setName("nickname").setDescription("Label, e.g. Main").setRequired(true))
        .addStringOption((o) =>
          o
            .setName("token")
            .setDescription("Session JWT from browser DevTools (same as dashboard)")
            .setRequired(true),
        )
        .addStringOption((o) => o.setName("api_key").setDescription("Optional x-api-key if your account uses one")),
    )
    .addSubcommand((sub) =>
      sub
        .setName("remove")
        .setDescription("Remove a saved account")
        .addStringOption((o) =>
          savedAccountOption(o, { name: "nickname", description: "Pick account to remove" }),
        ),
    )
    .addSubcommand((sub) =>
      sub
        .setName("list")
        .setDescription("Account stats with control buttons (refreshes first)"),
    )
    .addSubcommand((sub) =>
      sub
        .setName("refresh")
        .setDescription("Refresh balance and level from RoRush")
        .addStringOption((o) =>
          savedAccountOption(o, {
            name: "nickname",
            required: false,
            description: "Pick one account (omit for all of yours)",
          }),
        ),
    )
    .addSubcommand((sub) =>
      sub
        .setName("pause")
        .setDescription("Pause automation for one account (host: any nickname)")
        .addStringOption((o) =>
          savedAccountOption(o, { name: "nickname", description: "Pick account to pause" }),
        ),
    )
    .addSubcommand((sub) =>
      sub
        .setName("resume")
        .setDescription("Resume automation for one account")
        .addStringOption((o) =>
          savedAccountOption(o, { name: "nickname", description: "Pick account to resume" }),
        ),
    )
    .addSubcommand((sub) =>
      sub
        .setName("vault")
        .setDescription("After rain (+ limbo), move profit to RoRush vault (always on)")
        .addStringOption((o) =>
          savedAccountOption(o, { name: "nickname", description: "Pick account" }),
        )
        .addBooleanOption((o) => o.setName("on").setDescription("Enable or disable").setRequired(true)),
    ),
  new SlashCommandBuilder()
    .setName("rorush")
    .setDescription("RoRush tools")
    .addSubcommand((sub) =>
      sub
        .setName("vault")
        .setDescription("Vault lock and/or always vault rain profit — pick account and options")
        .addStringOption((o) => savedAccountOption(o, { description: "Pick your account" }))
        .addStringOption((o) => vaultLockDurationOption(o))
        .addBooleanOption((o) => vaultRainDuringLockOption(o)),
    )
    .addSubcommand((sub) =>
      sub
        .setName("off")
        .setDescription("Turn off all vault automation for an account (no RoRush early unlock)")
        .addStringOption((o) => savedAccountOption(o, { description: "Pick your account" })),
    ),
  new SlashCommandBuilder()
    .setName("owner")
    .setDescription("Host owner tools (HOST_DISCORD_USER_ID only)")
    .addSubcommand((sub) =>
      sub
        .setName("backup")
        .setDescription("Download encrypted backup JSON to move this host to another PC"),
    ),
  new SlashCommandBuilder()
    .setName("rain")
    .setDescription("Enable or disable automatic rain joins")
    .addStringOption((o) => savedAccountOption(o))
    .addBooleanOption((o) => o.setName("on").setDescription("On or off").setRequired(true)),
  new SlashCommandBuilder()
    .setName("cases")
    .setDescription("Enable or disable automatic case opens")
    .addStringOption((o) => savedAccountOption(o))
    .addBooleanOption((o) => o.setName("on").setDescription("On or off").setRequired(true)),
  new SlashCommandBuilder()
    .setName("limbo")
    .setDescription("Limbo wagers, manual tests, and rain filters")
    .addSubcommand((sub) =>
      sub
        .setName("set")
        .setDescription("Wager settings when rain requires play-through")
        .addStringOption((o) => savedAccountOption(o))
        .addBooleanOption((o) => o.setName("on").setDescription("Enable limbo wager").setRequired(true))
        .addNumberOption((o) =>
          o
            .setName("multiplier")
            .setDescription(`Target multiplier (min ${LIMBO_MIN_MULTIPLIER})`)
            .setMinValue(LIMBO_MIN_MULTIPLIER),
        )
        .addNumberOption((o) =>
          o
            .setName("bet")
            .setDescription(`Fallback bet in coins (min ${effectiveLimboMinBetCoins()})`)
            .setMinValue(effectiveLimboMinBetCoins()),
        ),
    )
    .addSubcommand((sub) =>
      sub
        .setName("test")
        .setDescription("One manual limbo bet (uses real balance)")
        .addStringOption((o) => savedAccountOption(o))
        .addNumberOption((o) =>
          o
            .setName("bet")
            .setDescription(`Bet in coins (min ${effectiveLimboMinBetCoins()})`)
            .setRequired(true)
            .setMinValue(effectiveLimboMinBetCoins()),
        )
        .addNumberOption((o) =>
          o
            .setName("multiplier")
            .setDescription("Override multiplier (optional)")
            .setMinValue(LIMBO_MIN_MULTIPLIER),
        ),
    )
    .addSubcommand((sub) =>
      sub
        .setName("filters")
        .setDescription("Min rain pool and pre-rain wager")
        .addStringOption((o) => savedAccountOption(o))
        .addNumberOption((o) => o.setName("min_rain").setDescription("Skip join if pool below this (coins)").setMinValue(0))
        .addBooleanOption((o) => o.setName("pre_wager").setDescription("Small limbo before join window")),
    ),
  new SlashCommandBuilder()
    .setName("mines")
    .setDescription("Auto-bet rain profit on Mines (cashout → vault)")
    .addSubcommand((sub) =>
      sub
        .setName("auto")
        .setDescription("After each rain, bet rain profit on mines until N rains")
        .addStringOption((o) => savedAccountOption(o))
        .addIntegerOption((o) =>
          o.setName("mines").setDescription("Mines on grid (1–24)").setRequired(true).setMinValue(1).setMaxValue(24),
        )
        .addNumberOption((o) =>
          o.setName("target").setDescription("Cash out at this multiplier (e.g. 5)").setRequired(true).setMinValue(1.01),
        )
        .addBooleanOption((o) =>
          o.setName("random").setDescription("Random tiles? No = clickable board in your feed").setRequired(true),
        )
        .addIntegerOption((o) =>
          o
            .setName("stop_after_rains")
            .setDescription("Turn off after this many rains (e.g. 5)")
            .setRequired(true)
            .setMinValue(1)
            .setMaxValue(500),
        )
        .addStringOption((o) =>
          o
            .setName("wallet")
            .setDescription("Real coins or FunCoins on RoRush")
            .setRequired(false)
            .addChoices(
              { name: "Real coins (vault on cashout)", value: "real" },
              { name: "FunCoins (practice — no vault)", value: "funcoins" },
            ),
        ),
    )
    .addSubcommand((sub) =>
      sub
        .setName("stop")
        .setDescription("Turn off mines auto")
        .addStringOption((o) => savedAccountOption(o, { required: false })),
    )
    .addSubcommand((sub) =>
      sub
        .setName("status")
        .setDescription("Mines auto settings")
        .addStringOption((o) => savedAccountOption(o, { required: false })),
    )
    .addSubcommand((sub) =>
      sub
        .setName("test")
        .setDescription("One manual mines round (real coins or FunCoins)")
        .addStringOption((o) => savedAccountOption(o))
        .addNumberOption((o) =>
          o.setName("bet").setDescription("Bet in coins (uses selected wallet)").setRequired(true).setMinValue(0.01),
        )
        .addIntegerOption((o) =>
          o.setName("mines").setDescription("Mines on grid (1–24)").setRequired(true).setMinValue(1).setMaxValue(24),
        )
        .addNumberOption((o) =>
          o.setName("target").setDescription("Cash out at this multiplier").setRequired(true).setMinValue(1.01),
        )
        .addBooleanOption((o) =>
          o.setName("random").setDescription("Random tiles? No = board in your feed").setRequired(true),
        )
        .addStringOption((o) =>
          o
            .setName("wallet")
            .setDescription("Real coins or FunCoins")
            .setRequired(true)
            .addChoices(
              { name: "Real coins", value: "real" },
              { name: "FunCoins", value: "funcoins" },
            ),
        ),
    ),
  new SlashCommandBuilder().setName("pause").setDescription("Staff: pause entire engine (all accounts)"),
  new SlashCommandBuilder().setName("resume").setDescription("Staff: resume entire engine"),
  ];

  if (isHostedSaasMode()) {
    core.push(
      new SlashCommandBuilder()
        .setName("license")
        .setDescription("Your subscription key (from the seller)")
        .addSubcommand((sub) =>
          sub
            .setName("redeem")
            .setDescription("Activate your key — only you see it")
            .addStringOption((o) => o.setName("key").setDescription("RP1… key").setRequired(true)),
        )
        .addSubcommand((sub) => sub.setName("status").setDescription("Check your subscription")),
      new SlashCommandBuilder()
        .setName("admin")
        .setDescription("Host: create license keys from Discord")
        .addSubcommand((sub) =>
          sub
            .setName("issue")
            .setDescription("Generate a new RP1 license key")
            .addUserOption((o) => o.setName("for").setDescription("Lock key to this Discord user (optional)"))
            .addIntegerOption((o) => o.setName("days").setDescription("Valid days (default 365)").setMinValue(1))
            .addStringOption((o) =>
              o.setName("plan").setDescription("Plan label").addChoices(
                { name: "standard", value: "standard" },
                { name: "pro", value: "pro" },
              ),
            ),
        )
        .addSubcommand((sub) => sub.setName("status").setDescription("License on this host PC")),
    );
  }

  return core.map((c) => c.toJSON());
}

function hostDiscordId(): string | null {
  return process.env.HOST_DISCORD_USER_ID?.trim() || null;
}

function isHost(userId: string): boolean {
  const h = hostDiscordId();
  return h != null && h === userId;
}

function interactionDisplayName(interaction: {
  member: import("discord.js").GuildMember | import("discord.js").APIInteractionGuildMember | null;
  user: import("discord.js").User;
}): string {
  const m = interaction.member;
  if (m && typeof m === "object" && "displayName" in m && typeof m.displayName === "string") {
    return m.displayName;
  }
  return interaction.user.username;
}

function requirePaidSeat(userId: string): string | null {
  if (isDiscordSeatActive(userId, hostDiscordId())) return null;
  return "No active license. Use `/license redeem` with your purchase key first.";
}

export async function startFriendsDiscordBot(): Promise<void> {
  const token = process.env.DISCORD_BOT_TOKEN?.trim();
  const guildId = process.env.DISCORD_GUILD_ID?.trim();
  if (!token || !guildId) {
    console.log("[friends-bot] skipped — set DISCORD_BOT_TOKEN + DISCORD_GUILD_ID in .env");
    return;
  }
  if (client) return;

  const intents = [GatewayIntentBits.Guilds];
  const membersIntent = useServerMembersIntent();
  if (membersIntent) {
    intents.push(GatewayIntentBits.GuildMembers);
  }

  client = new Client({ intents });

  client.once(Events.ClientReady, async (c) => {
    bindFriendsFeedClient(client);
    bindMinesBoardClient(client);
    const watching = botWatchingPresenceName();
    c.user.setPresence({
      activities: [{ name: watching, type: ActivityType.Watching }],
      status: "online",
    });
    console.log(`[friends-bot] logged in as ${c.user.tag} · watching "${watching}" · ${botRuntimeLabel()}`);
    const enc = encryptionKeyStatus();
    if (enc.ok) {
      console.log("[friends-bot] ENCRYPTION_KEY OK — /account add can save passwords");
    } else {
      console.error(`[friends-bot] ${enc.reason} — /account add will fail until .env is fixed and dev restarted`);
    }
    if (isFriendsHostMode() && projectRoot().replace(/\\/g, "/").includes("/workspace")) {
      console.warn(
        "[friends-bot] WARNING: Running from a cloud /workspace folder — do not use your real guild bot token here. " +
          "Reset the token if this was connected to your friends server.",
      );
    }
    const rest = new REST({ version: "10" }).setToken(token);
    const mode = isHostedSaasMode() ? "hosted SaaS (licenses on)" : "friends (no licenses)";
    try {
      await rest.put(Routes.applicationGuildCommands(c.application.id, guildId), {
        body: buildSlashCommands(),
      });
      console.log(`[friends-bot] slash commands registered on guild ${guildId} — ${mode}`);
    } catch (err) {
      console.error(
        "[friends-bot] slash command registration failed:",
        err instanceof Error ? err.message : String(err),
      );
      console.error("[friends-bot] Re-invite the bot with applications.commands scope, or check DISCORD_GUILD_ID.");
    }
  });

  client.on(Events.InteractionCreate, (interaction) => {
    if (interaction.isAutocomplete()) {
      void handleFriendsSlashAutocomplete(interaction, isHost);
      return;
    }
    if (interaction.isChatInputCommand()) {
      void handleInteraction(interaction);
      return;
    }
    if (interaction.isButton() || interaction.isStringSelectMenu()) {
      if (isNavComponent(interaction.customId)) {
        void handleNavInteraction(interaction);
        return;
      }
      if (isDashboardComponent(interaction.customId)) {
        void handleDashboardInteraction(interaction);
        return;
      }
    }
    if (interaction.isButton()) {
      if (interaction.customId === FRIENDS_CONNECT_BUTTON_ID) {
        void handleConnectButton(interaction);
        return;
      }
      if (FRIENDS_HOST_BUTTON_IDS.has(interaction.customId) && client && interaction.guildId) {
        const liveClient = client;
        void liveClient.guilds.fetch(interaction.guildId).then((guild) => {
          void handleHostToolButton(interaction, liveClient, guild, isHost(interaction.user.id));
        });
        return;
      }
      if (isVaultFlowButton(interaction.customId)) {
        void handleVaultFlowButton(interaction, interaction.user.id);
        return;
      }
      if (isRemoveConfirmButton(interaction.customId)) {
        void handleRemoveAccountButton(interaction, interaction.user.id);
      }
      if (interaction.customId.startsWith(MINES_BOARD_PREFIX)) {
        void handleMinesTileButton(interaction);
      }
    }
  });

  if (autoConnectFeedOnJoin()) {
    console.log(
      "[friends-bot] Private feed auto-connect on join: ON (DISCORD_AUTO_CONNECT_ON_JOIN=1)",
    );
  } else {
    console.log(
      "[friends-bot] Private feed auto-connect on join: OFF — members use #connect or /connect (set DISCORD_AUTO_CONNECT_ON_JOIN=1 to enable)",
    );
  }

  if (membersIntent) {
    console.log("[friends-bot] Rain Member auto-role on join: ON (GuildMembers intent)");
    client.on(Events.GuildMemberAdd, (member) => {
      if (member.guild.id !== guildId) return;
      void (async () => {
        await ensureMemberRoleOnMember({
          member,
          botToken: token,
          hostUserId: hostDiscordId(),
        }).catch((err) => {
          console.warn(
            "[friends-bot] member role on join:",
            err instanceof Error ? err.message : String(err),
          );
        });
        if (!autoConnectFeedOnJoin() || !client) return;
        try {
          await executeConnectForUser({
            client,
            guild: member.guild,
            botToken: token,
            discordUserId: member.id,
            username: member.user.username,
            activitySource: "auto_join",
            activityDisplayName: member.displayName ?? member.user.username,
          });
          console.log(`[friends-bot] auto-connect feed for ${member.user.tag}`);
        } catch (err) {
          console.warn(
            "[friends-bot] auto-connect on join:",
            err instanceof Error ? err.message : String(err),
          );
        }
      })();
    });
  } else {
    console.log(
      "[friends-bot] Rain Member auto-role on join: OFF — remove DISCORD_SERVER_MEMBERS_INTENT=0 or enable Server Members Intent in the Developer Portal.",
    );
  }

  client.on(Events.ShardDisconnect, (_event, shardId) => {
    console.warn(`[friends-bot] disconnected (shard ${shardId}) — discord.js will reconnect`);
  });

  client.on(Events.Error, (err) => {
    console.error("[friends-bot] client error:", err.message);
  });

  try {
    await client.login(token);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    await client.destroy().catch(() => undefined);
    client = null;
    bindFriendsFeedClient(null);
    bindMinesBoardClient(null);
    if (/disallowed intents/i.test(msg)) {
      throw new Error(`${msg} — ${serverMembersIntentHelp()} Or set DISCORD_SERVER_MEMBERS_INTENT=0 if the Portal toggle is off.`);
    }
    throw err;
  }
}

export async function stopFriendsDiscordBot(): Promise<void> {
  await client?.destroy();
  client = null;
  bindFriendsFeedClient(null);
  bindMinesBoardClient(null);
}

async function handleConnectButton(interaction: ButtonInteraction): Promise<void> {
  const botToken = process.env.DISCORD_BOT_TOKEN?.trim() ?? "";
  try {
    const ack = await deferEphemeral(interaction);
    if (!ack) {
      console.warn(
        "[friends-bot] connect button skipped — interaction already handled (duplicate bot process?)",
      );
      return;
    }
    if (!client || !interaction.guildId) {
      await editEmbeds(interaction, buildErrorEmbed("Run this inside your Discord server."));
      return;
    }
    const guild = await client.guilds.fetch(interaction.guildId);
    const joinResult = await executeConnectForUser({
      client,
      guild,
      botToken,
      discordUserId: interaction.user.id,
      username: interaction.user.username,
      activitySource: "button",
      activityDisplayName: interactionDisplayName(interaction),
    });
    await replyEphemeralEmbeds(interaction, [buildSetupJoinEmbed(joinResult)], [buildGlobalNavRow()]);
  } catch (err) {
    if (isInteractionAlreadyAcknowledged(err)) return;
    const msg = err instanceof Error ? err.message : String(err);
    if (isFriendsHostMode() && !isHost(interaction.user.id)) {
      void notifyStaffSlashError({
        command: "connect (button)",
        username: interaction.user.username,
        detail: msg,
      });
    }
    if (interaction.deferred || interaction.replied) {
      await editEmbeds(interaction, buildErrorEmbed(msg)).catch(() => undefined);
    }
  }
}

async function handleInteraction(interaction: ChatInputCommandInteraction): Promise<void> {
  const botToken = process.env.DISCORD_BOT_TOKEN?.trim() ?? "";
  try {
    const userId = interaction.user.id;

    if (interaction.commandName === "help") {
      await replyEmbeds(interaction, [buildHelpEmbed(), buildSetupGuideEmbed()]);
      return;
    }

    if (interaction.commandName === "jump") {
      if (!isHost(userId)) {
        await interaction.reply({ ephemeral: true, content: "Staff only." });
        return;
      }
      await interaction.deferReply({ ephemeral: true });
      if (!client || !interaction.guildId) {
        await editEmbeds(interaction, buildErrorEmbed("Run this inside your Discord server."));
        return;
      }
      const target = interaction.options.getUser("member", true);
      const guild = await client.guilds.fetch(interaction.guildId);
      try {
        const result = await hostJumpToUserFeedThread({
          client,
          guild,
          hostUserId: userId,
          targetUserId: target.id,
        });
        await editEmbeds(interaction, buildHostJumpEmbed(result));
      } catch (err) {
        await editEmbeds(
          interaction,
          buildErrorEmbed(err instanceof Error ? err.message : String(err)),
        );
      }
      return;
    }

    if (interaction.commandName === "thread") {
      const sub = interaction.options.getSubcommand();
      if (sub === "restore") {
        if (!isHost(userId)) {
          await interaction.reply({
            ephemeral: true,
            content: "Host only (`HOST_DISCORD_USER_ID`). Members use **`/connect`**.",
          });
          return;
        }
        await interaction.deferReply({ ephemeral: true });
        if (!client || !interaction.guildId) {
          await editEmbeds(interaction, buildErrorEmbed("Run this inside your Discord server."));
          return;
        }
        const targetUser = interaction.options.getUser("member", true);
        const guild = await client.guilds.fetch(interaction.guildId);
        const member = await guild.members.fetch(targetUser.id).catch(() => null);
        if (!member) {
          await editEmbeds(
            interaction,
            buildErrorEmbed("That user is not in this server — they must rejoin the server first."),
          );
          return;
        }
        try {
          const result = await restoreUserFeedThread({
            client,
            guild,
            token: botToken,
            targetUserId: targetUser.id,
            username: member.user.username,
          });
          await editEmbeds(
            interaction,
            buildThreadRestoreEmbed({
              threadId: result.threadId,
              created: result.created,
              roleRefreshed: result.roleRefreshed,
              memberTag: member.displayName ?? member.user.username,
            }),
          );
        } catch (err) {
          await editEmbeds(
            interaction,
            buildErrorEmbed(err instanceof Error ? err.message : String(err)),
          );
        }
        return;
      }
    }

    if (interaction.commandName === "connect") {
      const ack = await deferEphemeral(interaction);
      if (!ack) {
        console.warn(
          `[friends-bot] /connect skipped reply — interaction already handled (duplicate bot process?)`,
        );
        return;
      }
      if (!client || !interaction.guildId) {
        await editEmbeds(interaction, buildErrorEmbed("Run this inside your Discord server."));
        return;
      }
      const guild = await client.guilds.fetch(interaction.guildId);
      const joinResult = await runSetupJoin({
        client,
        guild,
        token: botToken,
        discordUserId: userId,
        username: interaction.user.username,
        activitySource: "slash",
        activityDisplayName: interactionDisplayName(interaction),
      });
      await replyEphemeralEmbeds(interaction, [buildSetupJoinEmbed(joinResult)], [buildGlobalNavRow()]);
      return;
    }

    if (interaction.commandName === "guide") {
      await replyEmbeds(interaction, [buildSetupGuideEmbed()]);
      return;
    }

    if (interaction.commandName === "earnings") {
      await replyEmbeds(interaction, [buildPersonalEarningsEmbed(userId)]);
      return;
    }

    if (interaction.commandName === "server") {
      const sub = interaction.options.getSubcommand();
      if (sub === "earnings") {
        if (!isHost(userId)) {
          await interaction.reply({ ephemeral: true, content: "Host-only — ask the server owner." });
          return;
        }
        await replyEmbeds(interaction, [buildServerEarningsBoardEmbed()]);
        return;
      }
      if (sub === "tools") {
        if (!isHost(userId)) {
          await interaction.reply({ ephemeral: true, content: "Host-only." });
          return;
        }
        await interaction.deferReply({ ephemeral: true });
        if (!client || !interaction.guildId) {
          await editEmbeds(interaction, buildErrorEmbed("Run this inside your Discord server."));
          return;
        }
        const hostLogId = getSettings().discord_host_log_channel_id?.trim();
        if (!hostLogId) {
          await editEmbeds(
            interaction,
            buildErrorEmbed("No **#host-log** yet — run **`/server setup`** first."),
          );
          return;
        }
        const ch = await client.channels.fetch(hostLogId).catch(() => null);
        if (!ch?.isTextBased()) {
          await editEmbeds(interaction, buildErrorEmbed("**#host-log** channel missing — run **`/server setup confirm:true`**."));
          return;
        }
        const { seedHostLogTools } = await import("./friends-host-tools.js");
        await seedHostLogTools(ch as import("discord.js").TextChannel, true);
        await editEmbeds(
          interaction,
          buildPlainResultEmbed(`Host tool buttons posted in <#${hostLogId}>.`, true),
        );
        return;
      }
      if (sub === "setup") {
        if (!isHost(userId)) {
          await interaction.reply({ ephemeral: true, content: "Host-only — ask the server owner." });
          return;
        }
        const hostId = hostDiscordId();
        if (!hostId) {
          await interaction.reply({
            ephemeral: true,
            content: out("Set `HOST_DISCORD_USER_ID` in `.env` first."),
          });
          return;
        }
        const priorLayout = parseFriendsServerLayout(getSettings().discord_server_layout_json);
        const confirmed = interaction.options.getBoolean("confirm") === true;
        if (priorLayout && !confirmed) {
          await interaction.reply({
            ephemeral: true,
            content: out(
              "Setup was already run. This command **deletes** old bot channels and private feed threads. " +
                "To continue, run **`/server setup confirm:true`**. To only fix permissions, ask support — or confirm only when you mean a full reset.",
            ),
          });
          return;
        }
        await interaction.deferReply({ ephemeral: true });
        if (!client || !interaction.guildId) {
          await interaction.editReply(out("Run this command inside your Discord server."));
          return;
        }
        const guild = await client.guilds.fetch(interaction.guildId);
        const { summaryLines } = await runFriendsServerSetup({
          guild,
          botUserId: client.user!.id,
          hostUserId: hostId,
          botToken,
        });
        await editEmbeds(interaction, buildSetupServerEmbed(summaryLines));
        return;
      }
    }

    if (interaction.commandName === "status") {
      await replyEmbeds(interaction, [buildStatusEmbed()]);
      return;
    }

    if (interaction.commandName === "dashboard") {
      const block = requirePaidSeat(userId);
      if (block) {
        await replyEmbeds(interaction, [buildErrorEmbed(out(block))]);
        return;
      }
      await interaction.deferReply({ ephemeral: true });
      const owned = accountsForDiscordUser(userId);
      if (owned.length > 0) {
        await engine.refreshAccountStatsForIds(owned.map((a) => a.id));
      }
      const { embed, components } = buildAccountDashboardView(userId);
      await replyEphemeralEmbeds(interaction, [embed], prependNavRow(components));
      return;
    }

    if (interaction.commandName === "account") {
      const block = requirePaidSeat(userId);
      if (block) {
        await replyEmbeds(interaction, [buildErrorEmbed(out(block))]);
        return;
      }
      const sub = interaction.options.getSubcommand();
      if (sub === "list") {
        await interaction.deferReply({ ephemeral: true });
        const owned = accountsForDiscordUser(userId);
        if (owned.length > 0) {
          await engine.refreshAccountStatsForIds(owned.map((a) => a.id));
        }
        const { embed, components } = buildAccountDashboardView(userId, undefined, "list");
        await replyEphemeralEmbeds(interaction, [embed], prependNavRow(components));
        return;
      }
      if (sub === "refresh") {
        await interaction.deferReply({ ephemeral: true });
        const nick = interaction.options.getString("nickname");
        const text = await refreshAccountsForDiscordUser(userId, nick ?? undefined);
        await replyWithResult(interaction, text, { accountNickname: nick ?? undefined });
        return;
      }
      if (sub === "pause" || sub === "resume") {
        await interaction.deferReply({ ephemeral: true });
        const nick = interaction.options.getString("nickname", true);
        const text = await setAccountAutomationPaused({
          actorUserId: userId,
          isHost: isHost(userId),
          nickname: nick,
          paused: sub === "pause",
        });
        await replyWithResult(interaction, text, { accountNickname: nick });
        return;
      }
      if (sub === "vault") {
        await interaction.deferReply({ ephemeral: true });
        const nick = interaction.options.getString("nickname", true);
        const text = await setAutoVaultDeposit(
          userId,
          nick,
          interaction.options.getBoolean("on", true),
        );
        await replyWithResult(interaction, text, { accountNickname: nick });
        return;
      }
      if (sub === "remove") {
        const nick = interaction.options.getString("nickname", true);
        const account = findOwnedAccount(userId, nick);
        if (!account) {
          await interaction.reply({
            ephemeral: true,
            embeds: [
              buildPlainResultEmbed(
                `No account **${nick}** saved for you. Use \`/account add\`.`,
                false,
              ),
            ],
          });
          return;
        }
        await interaction.reply({
          ephemeral: true,
          embeds: [
            buildPlainResultEmbed(
              `Remove **${account.nickname}** from this host?\n\nAutomation stops immediately for this nickname. This action cannot be undone from Discord.`,
              true,
              "Confirm removal",
            ),
          ],
          components: [buildRemoveAccountConfirmRow(account.id), buildGlobalNavRow()],
        });
        return;
      }
      await interaction.deferReply({ ephemeral: true });
      if (sub === "add") {
        const nick = interaction.options.getString("nickname", true);
        const text = await addAccountForDiscordUser({
          discordUserId: userId,
          nickname: nick,
          email: interaction.options.getString("email", true),
          password: interaction.options.getString("password", true),
        });
        await replyWithResult(interaction, text, { accountNickname: nick });
        if (/is linked/i.test(text)) {
          void logHostMemberActivity({
            kind: "account_add",
            discordUserId: userId,
            displayName: interactionDisplayName(interaction),
            detail: `Nickname **${nick}** (password login)`,
          });
        }
        return;
      }
      if (sub === "session") {
        const nick = interaction.options.getString("nickname", true);
        const text = await addAccountSessionForDiscordUser({
          discordUserId: userId,
          nickname: nick,
          sessionJwt: interaction.options.getString("token", true),
          apiKey: interaction.options.getString("api_key") ?? undefined,
        });
        await replyWithResult(interaction, text, { accountNickname: nick });
        if (/is linked/i.test(text)) {
          void logHostMemberActivity({
            kind: "account_session",
            discordUserId: userId,
            displayName: interactionDisplayName(interaction),
            detail: `Nickname **${nick}** (session JWT)`,
          });
        }
        return;
      }
    }

    if (interaction.commandName === "owner") {
      if (!isHost(userId)) {
        await interaction.reply({
          ephemeral: true,
          content: "Owner only — set `HOST_DISCORD_USER_ID` to your Discord user id.",
        });
        return;
      }
      const sub = interaction.options.getSubcommand();
      if (sub === "backup") {
        await interaction.deferReply({ ephemeral: true });
        try {
          const { path, filename } = writeHostBackupFile();
          const file = new AttachmentBuilder(path, { name: filename });
          await interaction.editReply({
            content:
              "Host backup (encrypted logins). Keep **`ENCRYPTION_KEY`** identical on the new PC, then restore via dashboard or support docs.",
            files: [file],
          });
        } catch (err) {
          await editEmbeds(
            interaction,
            buildErrorEmbed(err instanceof Error ? err.message : String(err)),
          );
        }
        return;
      }
    }

    if (interaction.commandName === "rorush") {
      const sub = interaction.options.getSubcommand();
      if (sub === "off") {
        await interaction.deferReply({ ephemeral: true });
        const nick = interaction.options.getString("account", true);
        const account = findOwnedAccount(userId, nick);
        if (!account) {
          await editEmbeds(
            interaction,
            resultEmbed(`No account **${nick}** saved for you. Use \`/account add\`.`),
          );
          return;
        }
        try {
          const text = await clearAllVaultPreferences(account.id);
          await replyWithResult(interaction, text, { accountNickname: nick });
        } catch (err) {
          await editEmbeds(
            interaction,
            buildErrorEmbed(err instanceof Error ? err.message : String(err)),
          );
        }
        return;
      }
      if (sub === "vault") {
        await interaction.deferReply({ ephemeral: true });
        const nick = interaction.options.getString("account", true);
        const account = accountsForDiscordUser(userId).find(
          (a) => a.nickname.toLowerCase() === nick.trim().toLowerCase(),
        );
        if (!account) {
          await editEmbeds(
            interaction,
            resultEmbed(`No account **${nick}** saved for you. Use \`/account add\`.`),
          );
          return;
        }
        const durationRaw = interaction.options.getString("duration") ?? "off";
        const minutes = parseVaultLockPreset(durationRaw);
        if (minutes == null) {
          await editEmbeds(interaction, buildErrorEmbed("Invalid vault lock duration."));
          return;
        }
        const vaultRainOpt = interaction.options.getBoolean("vault_rain");
        if (minutes <= 0) {
          if (vaultRainOpt === true) {
            const text = await setAutoVaultDeposit(userId, account.nickname, true);
            await replyWithResult(
              interaction,
              `${text}\n\nNo vault **lock** on RoRush — withdraw stays available. Rain profit keeps moving to vault until you turn this off (**vault_rain: false** or \`/account vault on:false\`).`,
              { accountNickname: account.nickname },
            );
            return;
          }
          if (vaultRainOpt === false) {
            const text = await setAutoVaultDeposit(userId, account.nickname, false);
            await replyWithResult(interaction, text, { accountNickname: account.nickname });
            return;
          }
          await editEmbeds(
            interaction,
            resultEmbed(
              [
                `**${account.nickname}** · No changes — pick **duration** to lock, or **vault_rain: true** to vault rains without locking.`,
              ].join("\n"),
            ),
          );
          return;
        }
        const vaultRain = vaultRainOpt ?? false;
        try {
          const text = await startVaultSession({
            accountId: account.id,
            lockMinutes: minutes,
            vaultRainDuringLock: vaultRain,
          });
          await replyWithResult(interaction, text, { accountNickname: account.nickname });
        } catch (err) {
          await editEmbeds(
            interaction,
            buildErrorEmbed(err instanceof Error ? err.message : String(err)),
          );
        }
        return;
      }
    }

    if (interaction.commandName === "rain") {
      const block = requirePaidSeat(userId);
      if (block) {
        await interaction.reply({ ephemeral: true, content: out(block) });
        return;
      }
      await interaction.deferReply({ ephemeral: true });
      const account = interaction.options.getString("account", true);
      const text = await setToggle(
        userId,
        account,
        "join_rain",
        interaction.options.getBoolean("on", true),
      );
      await replyWithResult(interaction, text, { accountNickname: account });
      return;
    }

    if (interaction.commandName === "cases") {
      const block = requirePaidSeat(userId);
      if (block) {
        await interaction.reply({ ephemeral: true, content: out(block) });
        return;
      }
      await interaction.deferReply({ ephemeral: true });
      const account = interaction.options.getString("account", true);
      const text = await setToggle(
        userId,
        account,
        "auto_open_cases",
        interaction.options.getBoolean("on", true),
      );
      await replyWithResult(interaction, text, { accountNickname: account });
      return;
    }

    if (interaction.commandName === "mines") {
      const block = requirePaidSeat(userId);
      if (block) {
        await interaction.reply({ ephemeral: true, content: out(block) });
        return;
      }
      const sub = interaction.options.getSubcommand();
      await interaction.deferReply({ ephemeral: true });
      const accountOpt = interaction.options.getString("account") ?? undefined;
      if (sub === "auto") {
        const { parseMinesWalletMode } = await import("../automation/mines-currency.js");
        const walletRaw = interaction.options.getString("wallet") ?? "real";
        const text = await setMinesAutoForUser({
          discordUserId: userId,
          nickname: accountOpt,
          minesCount: interaction.options.getInteger("mines", true),
          targetMultiplier: interaction.options.getNumber("target", true),
          randomTiles: interaction.options.getBoolean("random", true),
          stopAfterRains: interaction.options.getInteger("stop_after_rains", true),
          walletMode: parseMinesWalletMode(walletRaw === "funcoins" ? "funCoin" : "coin"),
        });
        await replyWithResult(interaction, text, { accountNickname: accountOpt });
        return;
      }
      if (sub === "stop") {
        const text = stopMinesAutoForUser(userId, accountOpt);
        await replyWithResult(interaction, text, { accountNickname: accountOpt });
        return;
      }
      if (sub === "status") {
        const text = minesStatusForUser(userId, accountOpt);
        await replyWithResult(interaction, text, { accountNickname: accountOpt });
        return;
      }
      if (sub === "test") {
        const { parseMinesWalletMode } = await import("../automation/mines-currency.js");
        const walletRaw = interaction.options.getString("wallet", true);
        const text = await testMinesForDiscordUser({
          discordUserId: userId,
          nickname: interaction.options.getString("account", true),
          betCoins: interaction.options.getNumber("bet", true),
          minesCount: interaction.options.getInteger("mines", true),
          targetMultiplier: interaction.options.getNumber("target", true),
          randomTiles: interaction.options.getBoolean("random", true),
          walletMode: parseMinesWalletMode(walletRaw === "funcoins" ? "funCoin" : "coin"),
        });
        await replyWithResult(interaction, text, {
          accountNickname: interaction.options.getString("account", true),
        });
        return;
      }
    }

    if (interaction.commandName === "limbo") {
      const block = requirePaidSeat(userId);
      if (block) {
        await interaction.reply({ ephemeral: true, content: out(block) });
        return;
      }
      const sub = interaction.options.getSubcommand();
      await interaction.deferReply({ ephemeral: true });
      const account = interaction.options.getString("account", true);
      if (sub === "set") {
        const text = await setLimbo(userId, account, {
          enabled: interaction.options.getBoolean("on", true),
          multiplier: interaction.options.getNumber("multiplier") ?? undefined,
          betCoins: interaction.options.getNumber("bet") ?? undefined,
        });
        await replyWithResult(interaction, text, { accountNickname: account });
        return;
      }
      if (sub === "test") {
        const text = await testLimboForDiscordUser(
          userId,
          account,
          interaction.options.getNumber("bet", true),
          interaction.options.getNumber("multiplier") ?? undefined,
        );
        await replyWithResult(interaction, text, { accountNickname: account });
        return;
      }
      if (sub === "filters") {
        const minRain = interaction.options.getNumber("min_rain");
        const preWager = interaction.options.getBoolean("pre_wager");
        const text = await setRainFilters(userId, account, {
          minRainCoins: minRain ?? undefined,
          preWagerBeforeRain: preWager ?? undefined,
        });
        await replyWithResult(interaction, text, { accountNickname: account });
        return;
      }
    }

    if (interaction.commandName === "license") {
      const sub = interaction.options.getSubcommand();
      if (sub === "status") {
        await interaction.reply({ ephemeral: true, content: out(discordSeatStatus(userId)) });
        return;
      }
      if (sub === "redeem") {
        await interaction.deferReply({ ephemeral: true });
        const key = interaction.options.getString("key", true).trim();
        try {
          const result = activateDiscordSeat(userId, key);
          if (!result.ok) {
            await interaction.editReply(out(result.message));
            return;
          }
          await interaction.editReply(
            out(
              `You're in · plan **${result.plan}** · expires ${result.expiresAt ?? "—"}\nNext: \`/account add\``,
            ),
          );
        } catch (err) {
          await interaction.editReply(out(err instanceof Error ? err.message : String(err)));
        }
        return;
      }
    }

    if (interaction.commandName === "admin") {
      if (!isHost(userId)) {
        await interaction.reply({ ephemeral: true, content: "Host-only command." });
        return;
      }
      const sub = interaction.options.getSubcommand();
      if (sub === "status") {
        const s = getLicenseStatus();
        await interaction.reply({
          ephemeral: true,
          content: s.active
            ? `Active · plan **${s.plan}** · ${s.licenseId} · expires ${s.expiresAt ?? "—"}`
            : `Not active${s.message ? `: ${s.message}` : ""}`,
        });
        return;
      }
      if (sub === "issue") {
        const pem = process.env.LICENSE_PRIVATE_KEY?.trim();
        if (!pem) {
          await interaction.reply({
            ephemeral: true,
            content: out("License signing is not configured on the host."),
          });
          return;
        }
        await interaction.deferReply({ ephemeral: true });
        const forUser = interaction.options.getUser("for");
        const days = interaction.options.getInteger("days") ?? 365;
        const plan = interaction.options.getString("plan") ?? "standard";
        const { key, exp, id } = issueLicenseKey({
          privateKeyPem: pem,
          days,
          plan,
          discordUserId: forUser?.id,
        });
        await interaction.editReply(
          out(
            [
              `**New license** · \`${id}\` · **${plan}** · ${days} days`,
              `Expires: ${new Date(exp * 1000).toISOString()}`,
              forUser ? `Locked to Discord user \`${forUser.id}\`` : "Not locked to a Discord user",
              "",
              "DM the key to the buyer → `/license redeem`",
              `\`\`\`\n${key}\n\`\`\``,
            ].join("\n"),
          ),
        );
        return;
      }
    }

    if (interaction.commandName === "pause" || interaction.commandName === "resume") {
      if (!isHost(userId)) {
        await interaction.reply({
          ephemeral: true,
          content: "Only the host can pause/resume global automation.",
        });
        return;
      }
      updateSettings({ global_pause: interaction.commandName === "pause" ? 1 : 0 });
      const paused = interaction.commandName === "pause";
      await replyEmbeds(interaction, [
        buildUpdateEmbed({
          title: paused ? "Global pause enabled" : "Global pause cleared",
          lines: [
            paused
              ? "All accounts on this host are paused until you run **`/resume`**."
              : "Rain, cases, and limbo automation may run again for enabled accounts.",
          ],
        }),
      ]);
      return;
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    const dupAck = isInteractionAlreadyAcknowledged(err);
    if (!dupAck && isFriendsHostMode() && !isHost(interaction.user.id)) {
      void notifyStaffSlashError({
        command: interaction.commandName,
        username: interaction.user.username,
        detail: msg,
      });
    } else if (dupAck) {
      console.warn(
        `[friends-bot] /${interaction.commandName} — interaction already acknowledged (stop duplicate npm run dev?)`,
      );
    }
    if (dupAck) return;
    const { isSessionJwtError, appendSessionHintIfNeeded } = await import("./friends-auth-hints.js");
    const authHint = isSessionJwtError(msg) ? appendSessionHintIfNeeded(msg) : msg;
    const friendMsg =
      isFriendsHostMode() && !isHost(interaction.user.id)
        ? isSessionJwtError(msg)
          ? authHint
          : `Something went wrong — ${discordSupportLine()}`
        : authHint;
    const errEmbed = buildErrorEmbed(out(friendMsg));
    await replyEphemeralEmbed(interaction, errEmbed);
  }
}
