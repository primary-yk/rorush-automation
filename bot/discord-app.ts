import {
  ChannelType,
  Client,
  EmbedBuilder,
  Events,
  GatewayIntentBits,
  REST,
  Routes,
  SlashCommandBuilder,
  type TextChannel,
} from "discord.js";
import { parseLicenseKey } from "../src/license/verify.js";
import type { PilotEventMessage } from "../src/relay/protocol.js";
import { getLinkByDiscordUser, getLinkByLicenseId, upsertLink } from "./store.js";
import { isPilotOnline, sendCommand } from "./pilot-hub.js";

const COMMANDS = [
  new SlashCommandBuilder()
    .setName("activate")
    .setDescription("Link your Rush Pilot license and open your private thread")
    .addStringOption((o) => o.setName("license").setDescription("Your RP1… license key").setRequired(true)),
  new SlashCommandBuilder().setName("status").setDescription("Engine status on your PC"),
  new SlashCommandBuilder().setName("accounts").setDescription("RoRush accounts in your Pilot"),
  new SlashCommandBuilder().setName("pause").setDescription("Global pause — stop automation"),
  new SlashCommandBuilder().setName("resume").setDescription("Resume automation"),
  new SlashCommandBuilder().setName("help").setDescription("How Rush Pilot + Discord works"),
].map((c) => c.toJSON());

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
        await interaction.reply({
          ephemeral: true,
          content: [
            "**Rush Pilot — Discord mode**",
            "1. Run Rush Pilot on your PC (`npm run dev`).",
            "2. `/activate` with your license key — you get a **private thread**.",
            "3. Set `DISCORD_BOT_RELAY_URL` in `.env` to your bot relay (from the vendor).",
            "4. Limbo hits/misses, rain, and accounts post in your thread.",
            "",
            "You can use the **website dashboard** or **Discord** — same engine.",
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
          `Linked license **${payload.id}** · plan **${payload.plan}**.\n` +
            `Your private thread: <#${threadId}>\n` +
            `On your PC: activate the same key in the dashboard (if needed), set \`DISCORD_BOT_RELAY_URL\`, run \`npm run dev\`.`,
        );

        const thread = await client.channels.fetch(threadId);
        if (thread?.isTextBased()) {
          await thread.send({
            embeds: [
              new EmbedBuilder()
                .setTitle("Rush Pilot connected")
                .setDescription(
                  `Welcome ${interaction.user.username}. This thread is yours — limbo **hits/misses**, **rain** joins, and **accounts** show up here when your PC is running Pilot.`,
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
        await interaction.deferReply({ ephemeral: true });
        const online = isPilotOnline(link.license_id);
        if (!online) {
          await interaction.editReply(
            "Pilot is **offline**. Start `npm run dev` on your machine with `DISCORD_BOT_RELAY_URL` pointing at the bot relay.",
          );
          return;
        }
        const text = await sendCommand(link.license_id, "status");
        await interaction.editReply(text);
        return;
      }

      if (interaction.commandName === "accounts") {
        await interaction.deferReply({ ephemeral: true });
        const text = await sendCommand(link.license_id, "accounts");
        await interaction.editReply(text.slice(0, 1900));
        return;
      }

      if (interaction.commandName === "pause") {
        await interaction.deferReply({ ephemeral: true });
        const text = await sendCommand(link.license_id, "pause");
        await interaction.editReply(text);
        return;
      }

      if (interaction.commandName === "resume") {
        await interaction.deferReply({ ephemeral: true });
        const text = await sendCommand(link.license_id, "resume");
        await interaction.editReply(text);
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

