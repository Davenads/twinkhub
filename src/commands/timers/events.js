import { SlashCommandBuilder } from 'discord.js';
import { getAllStates } from '../../timers/events/index.js';
import { renderEventsSummary } from '../../timers/summary.js';
import { getContentStore } from '../../content/store.js';

export const data = new SlashCommandBuilder()
  .setName('events')
  .setDescription('Show all tracked WoW event timers (BG, AGM, DMF, STV).');

export async function execute(interaction) {
  // Enduser command — open to everyone (no dev gate).
  const states = getAllStates(Date.now());
  const store = await getContentStore();
  await interaction.reply({
    ...renderEventsSummary(states, { store }),
    allowedMentions: { parse: [] }
  });
}
