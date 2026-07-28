import { SlashCommandBuilder } from 'discord.js';
import { getAllStates } from '../../timers/events/index.js';
import { rankedEvents, renderEventLine, eventTitle } from '../../timers/summary.js';

export const data = new SlashCommandBuilder()
  .setName('nextevent')
  .setDescription('Show the single most urgent WoW event right now.');

export async function execute(interaction) {
  // Enduser command — open to everyone (no dev gate).
  const states = getAllStates(Date.now());
  const [top] = rankedEvents(states);
  await interaction.reply({
    content: `**Next up:** ${eventTitle(top)} \u2014 ${renderEventLine(top, states[top])}`,
    allowedMentions: { parse: [] }
  });
}
