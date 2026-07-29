import { SlashCommandBuilder } from 'discord.js';
import { getContentStore, listPetFamilies } from '../../content/store.js';
import { resolveBracket } from '../../content/bracket.js';
import { capitalize } from '../../lib/text.js';
import { renderPets } from '../../services/pets.js';

const familyLabel = (family) => family.split('-').map(capitalize).join(' ');

export const data = new SlashCommandBuilder()
  .setName('pets')
  .setDescription('Hunter pet recommendations: families, abilities, and pet-XP management.')
  .addStringOption((o) =>
    o.setName('family').setDescription('Filter to one pet family').setAutocomplete(true)
  )
  .addStringOption((o) =>
    o.setName('bracket').setDescription('Content bracket (defaults to this server\u2019s primary)')
  );

export async function execute(interaction) {
  const bracket = await resolveBracket(interaction);
  const family = interaction.options.getString('family');
  const store = await getContentStore();
  const payload = renderPets({ store, bracket, family });
  await interaction.reply({ ...payload, allowedMentions: { parse: [] } });
}

export async function autocomplete(interaction) {
  const bracket = await resolveBracket(interaction);
  const store = await getContentStore();
  const focused = interaction.options.getFocused().toLowerCase();
  const choices = listPetFamilies(store, bracket)
    .filter((family) => family.includes(focused))
    .slice(0, 25)
    .map((family) => ({ name: familyLabel(family), value: family }));
  await interaction.respond(choices);
}
