import { SlashCommandBuilder } from 'discord.js';
import { getContentStore, listClassNames } from '../../content/store.js';
import { resolveBracket } from '../../content/bracket.js';
import { renderOptimize } from '../../services/optimize.js';
import { capitalize } from '../../lib/text.js';

// Enduser data command — open to everyone. The differentiator: a "did you forget
// X" checklist cross-referencing a class's core gear/enchant/consumable/quest
// coverage. `class` is autocompleted from the resolved bracket's roster; `faction`
// is a fixed choice set. All copy lives in the content store, rendered by the
// service — no user data is stored.
export const data = new SlashCommandBuilder()
  .setName('optimize')
  .setDescription('Checklist: are you missing a core slot, enchant, consumable, or quest?')
  .addStringOption((o) =>
    o.setName('class').setDescription('Which class').setRequired(true).setAutocomplete(true)
  )
  .addStringOption((o) =>
    o
      .setName('faction')
      .setDescription('Scope faction-specific picks')
      .setRequired(false)
      .addChoices({ name: 'Alliance', value: 'alliance' }, { name: 'Horde', value: 'horde' })
  );

export async function execute(interaction) {
  const bracket = await resolveBracket(interaction);
  const className = interaction.options.getString('class');
  const faction = interaction.options.getString('faction');
  const store = await getContentStore();
  const payload = renderOptimize({ store, bracket, className, faction });

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
