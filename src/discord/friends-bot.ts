import {
  Client,
  Events,
  GatewayIntentBits,
  REST,
  Routes,
  SlashCommandBuilder,
  type ChatInputCommandInteraction,
  type EmbedBuilder,
} from "discord.js";
import { LIMBO_MIN_MULTIPLIER } from "../config.js";
import { updateSettings } from "../db/repositories.js";
import {
  activateDiscordSeat,
  discordSeatStatus,
  isDiscordSeatActive,
  isHostedSaasMode,
} from "../license/discord-seat.js";
import { issueLicenseKey } from "../license/issue.js";
import { getLicenseStatus } from "../license/service.js";
import {
  addAccountForDiscordUser,
  addAccountSessionForDiscordUser,
  removeAccountForDiscordUser,
  setLimbo,
  setRainFilters,
  setToggle,
  testLimboForDiscordUser,
} from "./friends-commands.js";
import { bindFriendsFeedClient, friendsServerFeedActive, postToHostLogChannel } from "./friends-feed.js";
import { runFriendsServerSetup } from "./friends-server-setup.js";
import { runSetupJoin } from "./friends-user-thread.js";
import { isFriendsHostMode, notifyHostSlashError } from "./host-alerts.js";
import { discordSupportLine } from "./friends-copy.js";
import { ensureMemberRoleOnMember } from "./friends-guild-roles.js";
import { serverMembersIntentHelp, useServerMembersIntent } from "./friends-member-intent.js";
import { sanitizeDiscordOutbound } from "./sanitize-outbound.js";
import {
  buildAccountsEmbed,
  buildErrorEmbed,
  buildHelpEmbed,
  buildPlainResultEmbed,
  buildSetupGuideEmbed,
  buildSetupJoinEmbed,
  buildSetupServerEmbed,
  buildStatusEmbed,
  buildUpdateEmbed,
} from "./friends-ui.js";

function out(text: string): string {
  return sanitizeDiscordOutbound(text);
}

async function replyEmbeds(
  interaction: ChatInputCommandInteraction,
  embeds: EmbedBuilder[],
): Promise<void> {
  await interaction.reply({ ephemeral: true, embeds: embeds.slice(0, 10) });
}

async function editEmbeds(interaction: ChatInputCommandInteraction, embed: EmbedBuilder): Promise<void> {
  await interaction.editReply({ content: "", embeds: [embed] });
}

function resultEmbed(text: string): EmbedBuilder {
  const body = out(text);
  const fail =
    /no account|not saved|required|must be|license|host-only|invalid|expired|incomplete|could not verify/i.test(
      body,
    );
  return buildPlainResultEmbed(body, !fail);
}

let client: Client | null = null;

function buildSlashCommands() {
  const core = [
  new SlashCommandBuilder()
    .setName("connect")
    .setDescription("Open your private rain & limbo feed thread"),
  new SlashCommandBuilder()
    .setName("guide")
    .setDescription("Getting started — connect, accounts, automation"),
  new SlashCommandBuilder()
    .setName("server")
    .setDescription("Staff: Discord server layout")
    .addSubcommand((sub) =>
      sub
        .setName("setup")
        .setDescription("Replace bot channels/categories; repair roles & permissions"),
    ),
  new SlashCommandBuilder().setName("help").setDescription("Full command reference"),
  new SlashCommandBuilder().setName("status").setDescription("Automation engine status"),
  new SlashCommandBuilder()
    .setName("account")
    .setDescription("Manage your RoRush login (ephemeral)")
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
        .addStringOption((o) => o.setName("nickname").setDescription("Nickname to remove").setRequired(true)),
    )
    .addSubcommand((sub) => sub.setName("list").setDescription("Balances, levels, and toggles")),
  new SlashCommandBuilder()
    .setName("rain")
    .setDescription("Turn auto rain join on or off")
    .addStringOption((o) => o.setName("account").setDescription("Account nickname").setRequired(true))
    .addBooleanOption((o) => o.setName("on").setDescription("On or off").setRequired(true)),
  new SlashCommandBuilder()
    .setName("cases")
    .setDescription("Turn automatic case opens on or off")
    .addStringOption((o) => o.setName("account").setDescription("Account nickname").setRequired(true))
    .addBooleanOption((o) => o.setName("on").setDescription("On or off").setRequired(true)),
  new SlashCommandBuilder()
    .setName("limbo")
    .setDescription("Limbo wagers, test bets, and rain filters")
    .addSubcommand((sub) =>
      sub
        .setName("set")
        .setDescription("Wager settings when rain requires play-through")
        .addStringOption((o) => o.setName("account").setDescription("Your account nickname").setRequired(true))
        .addBooleanOption((o) => o.setName("on").setDescription("Enable limbo wager").setRequired(true))
        .addNumberOption((o) =>
          o
            .setName("multiplier")
            .setDescription(`Target multiplier (min ${LIMBO_MIN_MULTIPLIER})`)
            .setMinValue(LIMBO_MIN_MULTIPLIER),
        )
        .addNumberOption((o) => o.setName("bet").setDescription("Fallback bet in coins")),
    )
    .addSubcommand((sub) =>
      sub
        .setName("test")
        .setDescription("One manual limbo bet (uses real balance)")
        .addStringOption((o) => o.setName("account").setDescription("Your account nickname").setRequired(true))
        .addNumberOption((o) =>
          o.setName("bet").setDescription("Bet in coins (min 0.01)").setRequired(true).setMinValue(0.01),
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
        .addStringOption((o) => o.setName("account").setDescription("Your account nickname").setRequired(true))
        .addNumberOption((o) => o.setName("min_rain").setDescription("Skip join if pool below this (coins)").setMinValue(0))
        .addBooleanOption((o) => o.setName("pre_wager").setDescription("Small limbo before join window")),
    ),
  new SlashCommandBuilder().setName("pause").setDescription("Staff: pause all automation"),
  new SlashCommandBuilder().setName("resume").setDescription("Staff: resume automation"),
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
    console.log(`[friends-bot] logged in as ${c.user.tag}`);
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
    if (!interaction.isChatInputCommand()) return;
    void handleInteraction(interaction);
  });

  if (membersIntent) {
    console.log("[friends-bot] Rain Member auto-role on join: ON (GuildMembers intent)");
    client.on(Events.GuildMemberAdd, (member) => {
      if (member.guild.id !== guildId) return;
      void ensureMemberRoleOnMember({
        member,
        botToken: token,
        hostUserId: hostDiscordId(),
      }).catch((err) => {
        console.warn(
          "[friends-bot] member role on join:",
          err instanceof Error ? err.message : String(err),
        );
      });
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
}

async function handleInteraction(interaction: ChatInputCommandInteraction): Promise<void> {
  const botToken = process.env.DISCORD_BOT_TOKEN?.trim() ?? "";
  try {
    const userId = interaction.user.id;

    if (interaction.commandName === "help") {
      await replyEmbeds(interaction, [buildHelpEmbed(), buildSetupGuideEmbed()]);
      return;
    }

    if (interaction.commandName === "connect") {
      await interaction.deferReply({ ephemeral: true });
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
      });
      await editEmbeds(interaction, buildSetupJoinEmbed(joinResult));
      return;
    }

    if (interaction.commandName === "guide") {
      await replyEmbeds(interaction, [buildSetupGuideEmbed()]);
      return;
    }

    if (interaction.commandName === "server") {
      const sub = interaction.options.getSubcommand();
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

    if (interaction.commandName === "account") {
      const block = requirePaidSeat(userId);
      if (block) {
        await replyEmbeds(interaction, [buildErrorEmbed(out(block))]);
        return;
      }
      const sub = interaction.options.getSubcommand();
      if (sub === "list") {
        await replyEmbeds(interaction, [buildAccountsEmbed(userId)]);
        return;
      }
      await interaction.deferReply({ ephemeral: true });
      if (sub === "add") {
        const text = await addAccountForDiscordUser({
          discordUserId: userId,
          nickname: interaction.options.getString("nickname", true),
          email: interaction.options.getString("email", true),
          password: interaction.options.getString("password", true),
        });
        await editEmbeds(interaction, resultEmbed(text));
        return;
      }
      if (sub === "session") {
        const text = await addAccountSessionForDiscordUser({
          discordUserId: userId,
          nickname: interaction.options.getString("nickname", true),
          sessionJwt: interaction.options.getString("token", true),
          apiKey: interaction.options.getString("api_key") ?? undefined,
        });
        await editEmbeds(interaction, resultEmbed(text));
        return;
      }
      if (sub === "remove") {
        const text = await removeAccountForDiscordUser(
          userId,
          interaction.options.getString("nickname", true),
        );
        await editEmbeds(interaction, resultEmbed(text));
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
      const text = await setToggle(
        userId,
        interaction.options.getString("account", true),
        "join_rain",
        interaction.options.getBoolean("on", true),
      );
      await editEmbeds(interaction, resultEmbed(text));
      return;
    }

    if (interaction.commandName === "cases") {
      const block = requirePaidSeat(userId);
      if (block) {
        await interaction.reply({ ephemeral: true, content: out(block) });
        return;
      }
      await interaction.deferReply({ ephemeral: true });
      const text = await setToggle(
        userId,
        interaction.options.getString("account", true),
        "auto_open_cases",
        interaction.options.getBoolean("on", true),
      );
      await editEmbeds(interaction, resultEmbed(text));
      return;
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
        await editEmbeds(interaction, resultEmbed(text));
        return;
      }
      if (sub === "test") {
        const text = await testLimboForDiscordUser(
          userId,
          account,
          interaction.options.getNumber("bet", true),
          interaction.options.getNumber("multiplier") ?? undefined,
        );
        await editEmbeds(interaction, resultEmbed(text));
        return;
      }
      if (sub === "filters") {
        const minRain = interaction.options.getNumber("min_rain");
        const preWager = interaction.options.getBoolean("pre_wager");
        const text = await setRainFilters(userId, account, {
          minRainCoins: minRain ?? undefined,
          preWagerBeforeRain: preWager ?? undefined,
        });
        await editEmbeds(interaction, resultEmbed(text));
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
          title: paused ? "Automation paused" : "Automation resumed",
          lines: [paused ? "All accounts stop until you `/resume`." : "Rain and cases will run again."],
        }),
      ]);
      return;
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    if (isFriendsHostMode() && !isHost(interaction.user.id)) {
      if (friendsServerFeedActive()) {
        void postToHostLogChannel([
          {
            title: "Slash command error",
            description: `\`/${interaction.commandName}\` · **${interaction.user.username}**\n\`\`\`\n${msg.slice(0, 900)}\n\`\`\``,
            color: 0xef_44_44,
          },
        ]);
      } else {
        void notifyHostSlashError({
          command: interaction.commandName,
          userId: interaction.user.id,
          username: interaction.user.username,
          detail: msg,
        });
      }
    }
    const friendMsg =
      isFriendsHostMode() && !isHost(interaction.user.id)
        ? `Something went wrong — ${discordSupportLine()}`
        : msg;
    const errEmbed = buildErrorEmbed(out(friendMsg));
    if (interaction.deferred || interaction.replied) {
      await interaction.editReply({ content: "", embeds: [errEmbed] }).catch(() => undefined);
    } else {
      await interaction.reply({ ephemeral: true, embeds: [errEmbed] }).catch(() => undefined);
    }
  }
}
