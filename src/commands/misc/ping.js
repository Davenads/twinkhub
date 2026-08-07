import { SlashCommandBuilder, MessageFlags } from 'discord.js';
import { requireAdmin } from '../../lib/access.js';

export const data = new SlashCommandBuilder()
  .setName('ping')
  .setDescription('Health check — replies with gateway latency (dev only).');

export async function execute(interaction) {
  if (!(await requireAdmin(interaction))) return;
  const ws = Math.round(interaction.client.ws.ping);
  await interaction.reply({
    content: `Pong. Gateway ~${ws}ms.`,
    flags: MessageFlags.Ephemeral
  });
}
