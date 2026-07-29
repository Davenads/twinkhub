import { SlashCommandBuilder } from 'discord.js';
import { getContentStore, listClassNames } from '../../content/store.js';
import { resolveBracket } from '../../content/bracket.js';
import { renderConsumable } from '../../services/consumable.js';
import { capitalize } from '../../lib/text.js';

// Enduser data command — open to everyone. `type` is a fixed choice set (the five
// consumable types); `class` is autocompleted from the resolved bracket so users
// can't filter to a class with no data. All copy lives in consumables.json.
export const data = new SlashCommandBuilder()
  .setName('consumable')
  .setDescription('Recommended consumables for a bracket: potions, poisons, food, explosives.')
  .addStringOption((o) =>
    o
      .setName('type')
      .setDescription('Filter by consumable type')
      .setRequired(false)
      .addChoices(
        { name: 'Potion', value: 'potion' },
        { name: 'Poison', value: 'poison' },
        { name: 'Food', value: 'food' },
        { name: 'Explosive', value: 'explosive' },
        { name: 'World buff', value: 'worldbuff' }
      )
  )
  .addStringOption((o) =>
    o.setName('class').setDescription('Filter by class').setRequired(false).setAutocomplete(true)
  )
  .addStringOption((o) =>
    o
      .setName('bracket')
      .setDescription('Which bracket (defaults to this server\u2019s primary)')
      .setRequired(false)
  );

export async function execute(interaction) {
  const bracket = await resolveBracket(interaction);
  const type = interaction.options.getString('type');
  const className = interaction.options.getString('class');
  const store = await getContentStore();
  const payload = renderConsumable({ store, bracket, type, className });

  await interaction.reply({ ...payload, allowedMentions: { parse: [] } });
}

export async function autocomplete(interaction) {
  const typed = String(interaction.options.getFocused() ?? '').toLowerCase();
  const bracket = await resolveBracket(interaction);
  const store = await getContentStore();
  const choices = listClassNames(store, bracket)
    .filter((c) => c.toLowerCase().includes(typed))
    .slice(0, 25)
    .map((c) => ({ name: capitalize(c), value: c }));

  await interaction.respond(choices);
}
