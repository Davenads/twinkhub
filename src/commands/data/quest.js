import { SlashCommandBuilder } from 'discord.js';
import { getContentStore, listClassNames } from '../../content/store.js';
import { resolveBracket } from '../../content/bracket.js';
import { renderQuest } from '../../services/quest.js';
import { capitalize } from '../../lib/text.js';

// Enduser data command — open to everyone. `faction` is a fixed choice set;
// `class` is autocompleted from the resolved bracket. All copy lives in
// quests.json, rendered by the service; XP-risk turn-ins are flagged there.
export const data = new SlashCommandBuilder()
  .setName('quest')
  .setDescription('Gear-reward quests worth doing before the cap; flags XP-risk turn-ins.')
  .addStringOption((o) =>
    o.setName('class').setDescription('Filter by class').setRequired(false).setAutocomplete(true)
  )
  .addStringOption((o) =>
    o
      .setName('faction')
      .setDescription('Filter by faction')
      .setRequired(false)
      .addChoices({ name: 'Alliance', value: 'alliance' }, { name: 'Horde', value: 'horde' })
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
  const faction = interaction.options.getString('faction');
  const store = await getContentStore();
  const payload = renderQuest({ store, bracket, faction, className });

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
