import { SlashCommandBuilder } from 'discord.js';
import { getContentStore, listClassNames } from '../../content/store.js';
import { resolveBracket } from '../../content/bracket.js';
import { renderClass } from '../../services/classInfo.js';
import { capitalize } from '../../lib/text.js';

// Enduser data command — open to everyone. The `class` option is autocompleted
// from the resolved bracket's roster so users can't type a class that has no
// data. All display copy lives in the content store, rendered by the service.
export const data = new SlashCommandBuilder()
  .setName('class')
  .setDescription('Overview, specs, and stat priority for a class.')
  .addStringOption((o) =>
    o
      .setName('class')
      .setDescription('Which class')
      .setRequired(true)
      .setAutocomplete(true)
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
  const payload = renderClass({ store, bracket, className });

  await interaction.reply({ ...payload, allowedMentions: { parse: [] } });
}

export async function autocomplete(interaction) {
  const focused = interaction.options.getFocused().toLowerCase();
  const bracket = await resolveBracket(interaction);
  const store = await getContentStore();
  const choices = listClassNames(store, bracket)
    .filter((name) => name.includes(focused))
    .slice(0, 25)
    .map((name) => ({ name: capitalize(name), value: name }));

  await interaction.respond(choices);
}
