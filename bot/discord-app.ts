import {
  ChannelType,
  Client,
  EmbedBuilder,
  Events,
  GatewayIntentBits,
  REST,
  Routes,
  SlashCommandBuilder,
  type ChatInputCommandInteraction,
  type TextChannel,
} from "discord.js";
import { parseLicenseKey } from "../src/license/verify.js";
import type { BotCommandMessage, PilotEventMessage } from "../src/relay/protocol.js";
import { getLinkByDiscordUser, getLinkByLicenseId, upsertLink } from "./store.js";
import { isPilotOnline, sendCommand } from "./pilot-hub.js";

const COMMANDS = [
  new SlashCommandBuilder()
    .setName("activate")
    .setDescription("Link your license and open your private Rush Pilot thread")
    .addStringOption((o) => o.setName("license").setDescription("Your RP1… license key").setRequired(true)),
  new SlashCommandBuilder()
    .setName("setup")
    .setDescription("Discord-only setup steps (no website required)"),
  new SlashCommandBuilder().setName("help").setDescription("Commands and how Discord mode works"),
  new SlashCommandBuilder().setName("status").setDescription("Engine status on your PC"),
  new SlashCommandBuilder().setName("accounts").setDescription("Accounts, balance, level, toggles"),
  new SlashCommandBuilder()
    .setName("stats")
    .setDescription("Balance and level for one account")
    .addStringOption((o) => o.setName("account").setDescription("Nickname (default: first account)")),
  new SlashCommandBuilder()
    .setName("logs")
    .setDescription("Recent activity from your Pilot")
    .addIntegerOption((o) =>
      o.setName("lines").setDescription("How many lines (3–20)").setMinValue(3).setMaxValue(20),
    ),
  new SlashCommandBuilder().setName("pause").setDescription("Pause all automation"),
  new SlashCommandBuilder().setName("resume").setDescription("Resume automation"),
  new SlashCommandBuilder()
    .setName("rain")
    .setDescription("Turn join rain on or off")
    .addStringOption((o) => o.setName("account").setDescription("Account nickname").setRequired(true))
    .addBooleanOption((o) => o.setName("on").setDescription("true = on, false = off").setRequired(true)),
  new SlashCommandBuilder()
    .setName("cases")
    .setDescription("Turn auto-open cases on or off")
    .addStringOption((o) => o.setName("account").setDescription("Account nickname").setRequired(true))
    .addBooleanOption((o) => o.setName("on").setDescription("true = on, false = off").setRequired(true)),
  new SlashCommandBuilder()
    .setName("license")
    .setDescription("Save license on your PC (Pilot must be running — only you see this)")
    .addStringOption((o) => o.setName("key").setDescription("RP1… key").setRequired(true)),
  new SlashCommandBuilder()
    .setName("account")
    .setDescription("Manage RoRush logins on your PC")
    .addSubcommand((sub) =>
      sub
        .setName("add")
        .setDescription("Save email/password on your PC (ephemeral)")
        .addStringOption((o) => o.setName("nickname").setDescription("Your label, e.g. Main").setRequired(true))
        .addStringOption((o) => o.setName("email").setDescription("RoRush login email").setRequired(true))
        .addStringOption((o) => o.setName("password").setDescription("RoRush password").setRequired(true)),
    ),
].map((c) => c.toJSON());

const DISCORD_FIRST_HELP = [
  "**Rush Pilot — Discord-first**",
  "",
  "Your PC runs the engine (`npm run dev`). This bot is your **remote control + live feed**.",
  "",
  "**One-time setup**",
  "1. `npm run activate-license -- --key 'RP1…'` on your PC",
  "2. `.env`: `DISCORD_BOT_RELAY_URL=wss://…` (from the seller)",
  "3. `npm run dev` — wait for `[relay] connected`",
  "4. `/activate` here with the same license → this private thread",
  "5. `/account add` (only you see the password)",
  "6. `/rain account:Main on:true`",
  "",
  "**Day to day**",
  "• Live rain, limbo, errors → this thread",
  "• `/status` `/accounts` `/logs` `/pause` `/resume`",
  "• Website dashboard is **optional**",
].join("\n");

async function runPilotCommand(
  interaction: ChatInputCommandInteraction,
  licenseId: string,
  name: BotCommandMessage["name"],
  args?: Record<string, unknown>,
): Promise<void> {
  await interaction.deferReply({ ephemeral: true });
  if (!isPilotOnline(licenseId)) {
    await interaction.editReply(
      "Pilot is **offline**. On your PC run `npm run dev` with `DISCORD_BOT_RELAY_URL` set (see `/setup`).",
    );
    return;
  }
  try {
    const text = await sendCommand(licenseId, name, args);
    await interaction.editReply(text.slice(0, 1900));
  } catch (err) {
    await interaction.editReply(err instanceof Error ? err.message : String(err));
  }
}

export async function startDiscordBot(input: {
  token: string;
  guildId: string;
  parentChannelId: string;
  onReady?: () => void;
}): Promise<Client> {
  const client = new Client({
    intents: [GatewayIntentBits.Guilds],
  });

  client.once(Events.ClientReady, async (c) => {
    console.log(`Discord bot logged in as ${c.user.tag}`);
    const rest = new REST({ version: "10" }).setToken(input.token);
    await rest.put(Routes.applicationGuildCommands(c.application.id, input.guildId), { body: COMMANDS });
    console.log("Slash commands registered.");
    input.onReady?.();
  });

  client.on(Events.InteractionCreate, async (interaction) => {
    if (!interaction.isChatInputCommand()) return;

    const userId = interaction.user.id;

    try {
      if (interaction.commandName === "help") {
        await interaction.reply({ ephemeral: true, content: DISCORD_FIRST_HELP });
        return;
      }

      if (interaction.commandName === "setup") {
        await interaction.reply({
          ephemeral: true,
          content: [
            "**Install on your PC (Windows + WSL or Linux)**",
            "1. Clone Rush Pilot · copy `.env.example` → `.env`",
            "2. `ENCRYPTION_KEY` + `CAPTCHA_API_KEY` (2Captcha for rain)",
            "3. `npm run activate-license -- --key 'RP1…'`",
            "4. `DISCORD_BOT_RELAY_URL=wss://…` in `.env`",
            "5. `npm run dev` until `[relay] connected`",
            "6. `/activate` in Discord · `/account add` · `/rain`",
            "",
            "RoRush passwords **never** go to the seller — only your PC stores them.",
          ].join("\n"),
        });
        return;
      }

      if (interaction.commandName === "activate") {
        await interaction.deferReply({ ephemeral: true });
        const key = interaction.options.getString("license", true).trim();
        const { payload } = parseLicenseKey(key);
        if (payload.discordUserId && payload.discordUserId !== userId) {
          await interaction.editReply("This license is tied to a different Discord account.");
          return;
        }

        const guild = await client.guilds.fetch(input.guildId);
        const parent = (await guild.channels.fetch(input.parentChannelId)) as TextChannel | null;
        if (!parent?.isTextBased()) {
          await interaction.editReply("Bot parent channel misconfigured.");
          return;
        }

        const existing = getLinkByDiscordUser(userId);
        let threadId = existing?.thread_id;
        if (!threadId || existing.license_id !== payload.id) {
          const thread = await parent.threads.create({
            name: `pilot-${interaction.user.username}`.slice(0, 100),
            type: ChannelType.PrivateThread,
            invitable: false,
            reason: "Rush Pilot customer thread",
          });
          await thread.members.add(userId);
          threadId = thread.id;
        }

        upsertLink({ discordUserId: userId, licenseId: payload.id, threadId });
        await interaction.editReply(
          [
            `Linked **${payload.id}** · plan **${payload.plan}**`,
            `Your thread: <#${threadId}>`,
            "",
            "On your PC: same license via `npm run activate-license`, then `npm run dev`.",
            "Then `/account add` and `/rain` — use `/help` for the full list.",
          ].join("\n"),
        );

        const thread = await client.channels.fetch(threadId);
        if (thread?.isTextBased()) {
          await thread.send({
            embeds: [
              new EmbedBuilder()
                .setTitle("Your Rush Pilot feed")
                .setDescription(
                  "Rain joins, captcha errors, limbo wagers, and case opens land **here** while your PC runs Pilot.\n\nUse slash commands anywhere in the server — replies are **only visible to you** unless noted.",
                )
                .setColor(0x8b5cf6),
            ],
          });
        }
        return;
      }

      const link = getLinkByDiscordUser(userId);
      if (!link) {
        await interaction.reply({ ephemeral: true, content: "Run `/activate` with your license key first." });
        return;
      }

      if (interaction.commandName === "status") {
        await runPilotCommand(interaction, link.license_id, "status");
        return;
      }
      if (interaction.commandName === "accounts") {
        await runPilotCommand(interaction, link.license_id, "accounts");
        return;
      }
      if (interaction.commandName === "stats") {
        const account = interaction.options.getString("account") ?? undefined;
        await runPilotCommand(interaction, link.license_id, "stats", { nickname: account });
        return;
      }
      if (interaction.commandName === "logs") {
        const lines = interaction.options.getInteger("lines") ?? 12;
        await runPilotCommand(interaction, link.license_id, "logs", { limit: lines });
        return;
      }
      if (interaction.commandName === "pause") {
        await runPilotCommand(interaction, link.license_id, "pause");
        return;
      }
      if (interaction.commandName === "resume") {
        await runPilotCommand(interaction, link.license_id, "resume");
        return;
      }
      if (interaction.commandName === "rain") {
        await runPilotCommand(interaction, link.license_id, "rain_toggle", {
          nickname: interaction.options.getString("account", true),
          enabled: interaction.options.getBoolean("on", true),
        });
        return;
      }
      if (interaction.commandName === "cases") {
        await runPilotCommand(interaction, link.license_id, "cases_toggle", {
          nickname: interaction.options.getString("account", true),
          enabled: interaction.options.getBoolean("on", true),
        });
        return;
      }
      if (interaction.commandName === "license") {
        await runPilotCommand(interaction, link.license_id, "license_store", {
          key: interaction.options.getString("key", true),
        });
        return;
      }
      if (interaction.commandName === "account") {
        const sub = interaction.options.getSubcommand();
        if (sub === "add") {
          await runPilotCommand(interaction, link.license_id, "account_add", {
            nickname: interaction.options.getString("nickname", true),
            email: interaction.options.getString("email", true),
            password: interaction.options.getString("password", true),
          });
        }
        return;
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      if (interaction.deferred || interaction.replied) {
        await interaction.editReply({ content: msg }).catch(() => undefined);
      } else {
        await interaction.reply({ ephemeral: true, content: msg }).catch(() => undefined);
      }
    }
  });

  await client.login(input.token);
  return client;
}

export async function postEventToThread(
  client: Client,
  licenseId: string,
  event: PilotEventMessage,
): Promise<void> {
  const link = getLinkByLicenseId(licenseId);
  if (!link) return;
  const ch = await client.channels.fetch(link.thread_id);
  if (!ch?.isTextBased()) return;

  const e = new EmbedBuilder()
    .setTitle(event.embed.title)
    .setColor(event.embed.color ?? 0x8b5cf6);
  if (event.embed.description) e.setDescription(event.embed.description.slice(0, 4000));
  if (event.embed.fields) {
    e.addFields(event.embed.fields.slice(0, 25).map((f) => ({ ...f, value: f.value.slice(0, 1024) })));
  }
  if (event.embed.footer) e.setFooter(event.embed.footer);

  await ch.send({ embeds: [e] });
}
