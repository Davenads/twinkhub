import { SlashCommandBuilder } from 'discord.js';
import { getContentStore, listEnchantSlots, listClassNames } from '../../content/store.js';
import { resolveBracket } from '../../content/bracket.js';
import { renderEnchant } from '../../services/enchant.js';
import { capitalize } from '../../lib/text.js';

// Enduser data command — open to everyone. Both filters are optional and
// autocompleted from the resolved bracket so users can't type a slot/class that
// has no data. All display copy lives in enchants.json, rendered by the service.
export const data = new SlashCommandBuilder()
  .setName('enchant')
  .setDescription('Enchants for a bracket, flagging the no-level-requirement ones.')
  .addStringOption((o) =>
    o.setName('slot').setDescription('Filter by gear slot').setRequired(false).setAutocomplete(true)
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
  const slot = interaction.options.getString('slot');
  const className = interaction.options.getString('class');
  const store = await getContentStore();
  const payload = renderEnchant({ store, bracket, slot, className });

  await interaction.reply({ ...payload, allowedMentions: { parse: [] } });
}

export async function autocomplete(interaction) {
  const focused = interaction.options.getFocused(true);
  const typed = focused.value.toLowerCase();
  const bracket = await resolveBracket(interaction);
  const store = await getContentStore();

  const pool =
    focused.name === 'slot' ? listEnchantSlots(store, bracket) : listClassNames(store, bracket);
  const choices = pool
    .filter((v) => v.toLowerCase().includes(typed))
    .slice(0, 25)
    .map((v) => ({ name: capitalize(v), value: v }));

  await interaction.respond(choices);
}
