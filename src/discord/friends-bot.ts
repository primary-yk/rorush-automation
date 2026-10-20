import {
  Client,
  Events,
  GatewayIntentBits,
  REST,
  Routes,
  SlashCommandBuilder,
  type ChatInputCommandInteraction,
} from "discord.js";
import { updateSettings } from "../db/repositories.js";
import { activateLicense, getLicenseStatus } from "../license/service.js";
import { issueLicenseKey } from "../license/issue.js";
import {
  addAccountForDiscordUser,
  engineStatusText,
  formatAccountList,
  removeAccountForDiscordUser,
  setLimbo,
  setToggle,
} from "./friends-commands.js";

let client: Client | null = null;

const COMMANDS = [
  new SlashCommandBuilder().setName("setup").setDescription("How Rush Pilot works in this server"),
  new SlashCommandBuilder().setName("status").setDescription("Is the host engine running?"),
  new SlashCommandBuilder().setName("accounts").setDescription("Your linked RoRush accounts"),
  new SlashCommandBuilder()
    .setName("account")
    .setDescription("Add or remove your RoRush login (stored on host PC only)")
    .addSubcommand((sub) =>
      sub
        .setName("add")
        .setDescription("Save email + password (ephemeral — only you see it)")
        .addStringOption((o) => o.setName("nickname").setDescription("Your label, e.g. Main").setRequired(true))
        .addStringOption((o) => o.setName("email").setDescription("RoRush email").setRequired(true))
        .addStringOption((o) => o.setName("password").setDescription("RoRush password").setRequired(true)),
    )
    .addSubcommand((sub) =>
      sub
        .setName("remove")
        .setDescription("Remove an account you added")
        .addStringOption((o) => o.setName("nickname").setDescription("Nickname to remove").setRequired(true)),
    ),
  new SlashCommandBuilder()
    .setName("rain")
    .setDescription("Toggle auto-join rain")
    .addStringOption((o) => o.setName("account").setDescription("Your account nickname").setRequired(true))
    .addBooleanOption((o) => o.setName("on").setDescription("true = on").setRequired(true)),
  new SlashCommandBuilder()
    .setName("cases")
    .setDescription("Toggle auto-open reward cases")
    .addStringOption((o) => o.setName("account").setDescription("Your account nickname").setRequired(true))
    .addBooleanOption((o) => o.setName("on").setDescription("true = on").setRequired(true)),
  new SlashCommandBuilder()
    .setName("limbo")
    .setDescription("Limbo wager when rain requires play-through")
    .addStringOption((o) => o.setName("account").setDescription("Your account nickname").setRequired(true))
    .addBooleanOption((o) => o.setName("on").setDescription("Enable limbo wager").setRequired(true))
    .addNumberOption((o) => o.setName("multiplier").setDescription("Target multiplier (min 1.1)").setMinValue(1.1))
    .addNumberOption((o) => o.setName("bet").setDescription("Fallback bet in coins if pool unknown")),
  new SlashCommandBuilder().setName("pause").setDescription("Pause all automation (host)"),
  new SlashCommandBuilder().setName("resume").setDescription("Resume automation (host)"),
  new SlashCommandBuilder()
    .setName("license")
    .setDescription("Activate Rush Pilot on the host PC (only you see the key)")
    .addStringOption((o) => o.setName("key").setDescription("RP1… license key").setRequired(true)),
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
].map((c) => c.toJSON());

const SETUP_TEXT = [
  "**Rush Pilot — friends mode**",
  "",
  "The **host** runs the engine on their PC (`npm run dev`). You only use Discord.",
  "",
  "1. `/account add` — your RoRush email/password (only you see it; stored encrypted on host PC)",
  "2. `/rain account:Main on:true`",
  "3. `/limbo account:Main on:true multiplier:1.1` — if rain needs a wager",
  "4. `/cases account:Main on:true` — optional",
  "",
  "If you sell access with keys: `/license key:RP1…` on the host PC (no website).",
  "Rain, errors, and limbo results post in the log channel when configured.",
].join("\n");

function hostDiscordId(): string | null {
  return process.env.HOST_DISCORD_USER_ID?.trim() || null;
}

function isHost(userId: string): boolean {
  const h = hostDiscordId();
  return h != null && h === userId;
}

export async function startFriendsDiscordBot(): Promise<void> {
  const token = process.env.DISCORD_BOT_TOKEN?.trim();
  const guildId = process.env.DISCORD_GUILD_ID?.trim();
  if (!token || !guildId) {
    console.log("[friends-bot] skipped — set DISCORD_BOT_TOKEN + DISCORD_GUILD_ID in .env");
    return;
  }
  if (client) return;

  client = new Client({ intents: [GatewayIntentBits.Guilds] });

  client.once(Events.ClientReady, async (c) => {
    console.log(`[friends-bot] logged in as ${c.user.tag}`);
    const rest = new REST({ version: "10" }).setToken(token);
    await rest.put(Routes.applicationGuildCommands(c.application.id, guildId), { body: COMMANDS });
    console.log("[friends-bot] slash commands registered on guild", guildId);
  });

  client.on(Events.InteractionCreate, (interaction) => {
    if (!interaction.isChatInputCommand()) return;
    void handleInteraction(interaction);
  });

  await client.login(token);
}

export async function stopFriendsDiscordBot(): Promise<void> {
  await client?.destroy();
  client = null;
}

async function handleInteraction(interaction: ChatInputCommandInteraction): Promise<void> {
  try {
    const userId = interaction.user.id;

    if (interaction.commandName === "setup") {
      await interaction.reply({ ephemeral: true, content: SETUP_TEXT });
      return;
    }

    if (interaction.commandName === "status") {
      await interaction.reply({ ephemeral: true, content: engineStatusText() });
      return;
    }

    if (interaction.commandName === "accounts") {
      await interaction.reply({ ephemeral: true, content: formatAccountList(userId) });
      return;
    }

    if (interaction.commandName === "account") {
      const sub = interaction.options.getSubcommand();
      await interaction.deferReply({ ephemeral: true });
      if (sub === "add") {
        const text = await addAccountForDiscordUser({
          discordUserId: userId,
          nickname: interaction.options.getString("nickname", true),
          email: interaction.options.getString("email", true),
          password: interaction.options.getString("password", true),
        });
        await interaction.editReply(text);
        return;
      }
      if (sub === "remove") {
        const text = await removeAccountForDiscordUser(
          userId,
          interaction.options.getString("nickname", true),
        );
        await interaction.editReply(text);
        return;
      }
    }

    if (interaction.commandName === "rain") {
      await interaction.deferReply({ ephemeral: true });
      const text = await setToggle(
        userId,
        interaction.options.getString("account", true),
        "join_rain",
        interaction.options.getBoolean("on", true),
      );
      await interaction.editReply(text);
      return;
    }

    if (interaction.commandName === "cases") {
      await interaction.deferReply({ ephemeral: true });
      const text = await setToggle(
        userId,
        interaction.options.getString("account", true),
        "auto_open_cases",
        interaction.options.getBoolean("on", true),
      );
      await interaction.editReply(text);
      return;
    }

    if (interaction.commandName === "limbo") {
      await interaction.deferReply({ ephemeral: true });
      const mult = interaction.options.getNumber("multiplier") ?? undefined;
      const bet = interaction.options.getNumber("bet") ?? undefined;
      const text = await setLimbo(userId, interaction.options.getString("account", true), {
        enabled: interaction.options.getBoolean("on", true),
        multiplier: mult,
        betCoins: bet,
      });
      await interaction.editReply(text);
      return;
    }

    if (interaction.commandName === "license") {
      await interaction.deferReply({ ephemeral: true });
      const key = interaction.options.getString("key", true).trim();
      try {
        const status = activateLicense(key);
        if (!status.active) {
          await interaction.editReply(status.message ?? "Invalid or expired license.");
          return;
        }
        await interaction.editReply(
          `License active on **this PC** · plan **${status.plan}** · id \`${status.licenseId}\`\nExpires: ${status.expiresAt ?? "—"}`,
        );
      } catch (err) {
        await interaction.editReply(err instanceof Error ? err.message : String(err));
      }
      return;
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
            content: "Set `LICENSE_PRIVATE_KEY` in the host `.env` to mint keys (see `npm run license:keygen`).",
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
          [
            `**New license** · \`${id}\` · **${plan}** · ${days} days`,
            `Expires: ${new Date(exp * 1000).toISOString()}`,
            forUser ? `Locked to Discord user \`${forUser.id}\`` : "Not locked to a Discord user",
            "",
            "Give this key to your customer (DM). They run `/license` in Discord — **no website**:",
            `\`\`\`\n${key}\n\`\`\``,
          ].join("\n"),
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
      await interaction.reply({
        ephemeral: true,
        content: interaction.commandName === "pause" ? "Automation **paused**." : "Automation **resumed**.",
      });
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
}
