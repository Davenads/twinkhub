import { SlashCommandBuilder } from 'discord.js';
import { getContentStore, listGearItems } from '../../content/store.js';
import { resolveBracket } from '../../content/bracket.js';
import { renderItem } from '../../services/item.js';

// Enduser data command — open to everyone. Looks up a single gear item. The
// `name` option is autocompleted from the bracket's item index; the autocomplete
// value is the item id, so execute resolves it directly. All copy is data.
export const data = new SlashCommandBuilder()
  .setName('item')
  .setDescription('Look up a single gear item: stats, source, faction, notes.')
  .addStringOption((o) =>
    o.setName('name').setDescription('Item name').setRequired(true).setAutocomplete(true)
  );

export async function execute(interaction) {
  const bracket = await resolveBracket(interaction);
  const id = interaction.options.getString('name'); // autocomplete value is the item id
  const store = await getContentStore();
  const payload = renderItem({ store, bracket, id });

  await interaction.reply({ ...payload, allowedMentions: { parse: [] } });
}

export async function autocomplete(interaction) {
  const typed = interaction.options.getFocused().toLowerCase();
  const bracket = await resolveBracket(interaction);
  const store = await getContentStore();

  const choices = listGearItems(store, bracket)
    .filter((it) => it.name.toLowerCase().includes(typed) || it.id.includes(typed))
    .slice(0, 25)
    .map((it) => ({ name: `${it.name} \u2014 ${it.slot}`.slice(0, 100), value: it.id }));

  await interaction.respond(choices);
}
