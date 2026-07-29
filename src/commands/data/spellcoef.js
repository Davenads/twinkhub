import { SlashCommandBuilder } from 'discord.js';
import { getContentStore, listSpellcoefClasses } from '../../content/store.js';
import { resolveBracket } from '../../content/bracket.js';
import { renderSpellcoef } from '../../services/spellcoef.js';
import { capitalize } from '../../lib/text.js';

export const data = new SlashCommandBuilder()
  .setName('spellcoef')
  .setDescription('Level-19 spell power coefficients: how much spell power a caster spell gains.')
  .addStringOption((o) =>
    o.setName('class').setDescription('Which caster/hybrid class').setRequired(true).setAutocomplete(true)
  )
  .addStringOption((o) =>
    o
      .setName('bracket')
      .setDescription('Which bracket (defaults to this server\u2019s primary)')
      .setRequired(false)
  );

export async function execute(interaction) {
  const bracket = await resolveBracket(interaction);
  const className = interaction.options.getString('class');
  const store = await getContentStore();
  const payload = renderSpellcoef({ store, bracket, className });
  await interaction.reply({ ...payload, allowedMentions: { parse: [] } });
}

export async function autocomplete(interaction) {
  const typed = String(interaction.options.getFocused() ?? '').toLowerCase();
  const bracket = await resolveBracket(interaction);
  const store = await getContentStore();
  const choices = listSpellcoefClasses(store, bracket)
    .filter((c) => c.toLowerCase().includes(typed))
    .slice(0, 25)
    .map((c) => ({ name: capitalize(c), value: c }));
  await interaction.respond(choices);
}
