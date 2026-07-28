import { SlashCommandBuilder, MessageFlags } from 'discord.js';
import { requireDevRole } from '../../lib/access.js';
import { setDmEnabled } from '../../config/guildConfig.js';

export const data = new SlashCommandBuilder()
  .setName('timerdms')
  .setDescription('Toggle DM alerts to alert-role holders for this server (dev only).')
  .addBooleanOption((o) =>
    o
      .setName('enabled')
      .setDescription('True to DM role holders on alerts, false to disable')
      .setRequired(true)
  );

export async function execute(interaction) {
  if (!(await requireDevRole(interaction))) return;
  if (!interaction.inGuild()) {
    await interaction.reply({
      content: 'This command can only be used in a server.',
      flags: MessageFlags.Ephemeral
    });
    return;
  }

  const enabled = interaction.options.getBoolean('enabled', true);
  await setDmEnabled(interaction.guildId, enabled);

  await interaction.reply({
    content: `Timer DMs are now **${enabled ? 'on' : 'off'}** for this server.`,
    flags: MessageFlags.Ephemeral
  });
}
