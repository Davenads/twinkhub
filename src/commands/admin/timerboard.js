import { SlashCommandBuilder, ChannelType, MessageFlags } from 'discord.js';
import { requireAdmin } from '../../lib/access.js';
import { loadGuildConfig, setTimerBoard } from '../../config/guildConfig.js';
import { getAllStates } from '../../timers/events/index.js';
import { renderEventsSummary } from '../../timers/summary.js';

export const data = new SlashCommandBuilder()
  .setName('timerboard')
  .setDescription('Manage the auto-updating event timer board for this server (dev only).')
  .addSubcommand((s) =>
    s
      .setName('set')
      .setDescription('Post the live timer board in a channel (or move it there).')
      .addChannelOption((o) =>
        o
          .setName('channel')
          .setDescription('Channel to host the board')
          .addChannelTypes(ChannelType.GuildText)
          .setRequired(true)
      )
  )
  .addSubcommand((s) => s.setName('off').setDescription('Stop and remove the timer board.'));

/** Best-effort delete of a previously posted board message. */
async function removeExistingBoard(guild, board) {
  if (!board?.channelId || !board?.messageId) return;
  const channel = await guild.channels.fetch(board.channelId).catch(() => null);
  if (!channel?.isTextBased?.()) return;
  const msg = await channel.messages.fetch(board.messageId).catch(() => null);
  await msg?.delete().catch(() => {});
}

export async function execute(interaction) {
  if (!(await requireAdmin(interaction))) return;
  if (!interaction.inGuild()) {
    await interaction.reply({
      content: 'This command can only be used in a server.',
      flags: MessageFlags.Ephemeral
    });
    return;
  }

  const sub = interaction.options.getSubcommand();

  if (sub === 'off') {
    const cfg = await loadGuildConfig(interaction.guildId);
    await removeExistingBoard(interaction.guild, cfg.timerBoard);
    await setTimerBoard(interaction.guildId, null);
    await interaction.reply({ content: 'Timer board disabled.', flags: MessageFlags.Ephemeral });
    return;
  }

  // sub === 'set'
  const channel = interaction.options.getChannel('channel', true);
  await interaction.deferReply({ flags: MessageFlags.Ephemeral });

  // If a board already exists (here or elsewhere), remove the old message first.
  const cfg = await loadGuildConfig(interaction.guildId);
  await removeExistingBoard(interaction.guild, cfg.timerBoard);

  const payload = renderEventsSummary(getAllStates(Date.now()));
  let message;
  try {
    message = await channel.send({ ...payload, allowedMentions: { parse: [] } });
  } catch {
    await interaction.editReply(
      `Couldn't post in <#${channel.id}> — check I can send messages and embeds there.`
    );
    return;
  }

  await setTimerBoard(interaction.guildId, { channelId: channel.id, messageId: message.id });
  await interaction.editReply(
    `Timer board is now live in <#${channel.id}>. It refreshes every minute.`
  );
}
