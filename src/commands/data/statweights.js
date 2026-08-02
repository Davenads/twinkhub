import { SlashCommandBuilder } from 'discord.js';
import { getContentStore, listStatweightClasses } from '../../content/store.js';
import { resolveBracket } from '../../content/bracket.js';
import { renderStatweights } from '../../services/statweights.js';
import { capitalize } from '../../lib/text.js';

export const data = new SlashCommandBuilder()
  .setName('statweights')
  .setDescription('Why a class prioritizes certain stats: conversions, formulas, and hit caps.')
  .addStringOption((o) =>
    o.setName('class').setDescription('Which class').setRequired(true).setAutocomplete(true)
  );

export async function execute(interaction) {
  const bracket = await resolveBracket(interaction);
  const className = interaction.options.getString('class');
  const store = await getContentStore();
  const payload = renderStatweights({ store, bracket, className });
  await interaction.reply({ ...payload, allowedMentions: { parse: [] } });
}

export async function autocomplete(interaction) {
  const typed = String(interaction.options.getFocused() ?? '').toLowerCase();
  const bracket = await resolveBracket(interaction);
  const store = await getContentStore();
  const choices = listStatweightClasses(store, bracket)
    .filter((c) => c.toLowerCase().includes(typed))
    .slice(0, 25)
    .map((c) => ({ name: capitalize(c), value: c }));
  await interaction.respond(choices);
}
