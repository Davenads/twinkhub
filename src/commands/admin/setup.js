import { SlashCommandBuilder, ChannelType, MessageFlags } from 'discord.js';
import { requireDevRole } from '../../lib/access.js';
import { saveGuildConfig } from '../../config/guildConfig.js';

export const data = new SlashCommandBuilder()
  .setName('setup')
  .setDescription('Set the alert channel and role for event timers (dev only).')
  .addChannelOption((o) =>
    o
      .setName('channel')
      .setDescription('Channel where event alerts are posted')
      .addChannelTypes(ChannelType.GuildText)
      .setRequired(true)
  )
  .addRoleOption((o) =>
    o.setName('role').setDescription('Role pinged on events').setRequired(true)
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

  const channel = interaction.options.getChannel('channel');
  const role = interaction.options.getRole('role');

  // saveGuildConfig merges over existing config, preserving dmEnabled et al.
  const cfg = await saveGuildConfig(interaction.guildId, {
    alertChannelId: channel.id,
    alertRoleId: role.id
  });

  await interaction.reply({
    content:
      `Setup saved.\n` +
      `\u2022 Alert channel: <#${channel.id}>\n` +
      `\u2022 Alert role: <@&${role.id}>\n` +
      `\u2022 DMs: ${cfg.dmEnabled ? 'on' : 'off'}`,
    flags: MessageFlags.Ephemeral,
    allowedMentions: { parse: [] }
  });
}
