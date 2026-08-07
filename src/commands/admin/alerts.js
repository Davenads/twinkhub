import { SlashCommandBuilder, MessageFlags } from 'discord.js';
import { requireAdmin } from '../../lib/access.js';
import { setEventEnabled } from '../../config/guildConfig.js';
import { EVENT_KEYS } from '../../timers/events/index.js';
import { EVENT_CHOICES } from '../../timers/summary.js';

export const data = new SlashCommandBuilder()
  .setName('alerts')
  .setDescription('Enable or disable a specific event alert for this server (dev only).')
  .addStringOption((o) =>
    o
      .setName('event')
      .setDescription('Which event')
      .setRequired(true)
      .addChoices(...EVENT_CHOICES)
  )
  .addBooleanOption((o) =>
    o.setName('enabled').setDescription('True to enable, false to disable').setRequired(true)
  );

export async function execute(interaction) {
  if (!(await requireAdmin(interaction))) return;
  if (!interaction.inGuild()) {
    await interaction.reply({
      content: 'This command can only be used in a server.',
      flags: MessageFlags.Ephemeral
    });
    return;
  }

  const event = interaction.options.getString('event', true);
  const enabled = interaction.options.getBoolean('enabled', true);

  const cfg = await setEventEnabled(interaction.guildId, event, enabled);
  const summary = EVENT_KEYS.map(
    (k) => `${k.toUpperCase()} ${cfg.timers[k] !== false ? 'on' : 'off'}`
  ).join(' \u00b7 ');

  await interaction.reply({
    content:
      `${event.toUpperCase()} alerts are now **${enabled ? 'on' : 'off'}**.\n` +
      `Current: ${summary}`,
    flags: MessageFlags.Ephemeral
  });
}
