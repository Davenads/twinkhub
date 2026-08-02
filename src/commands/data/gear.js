import { SlashCommandBuilder } from 'discord.js';
import { getContentStore, listGearClasses, gearSlots } from '../../content/store.js';
import { resolveBracket } from '../../content/bracket.js';
import { renderGear } from '../../services/gear.js';
import { capitalize } from '../../lib/text.js';

export const data = new SlashCommandBuilder()
  .setName('gear')
  .setDescription('Filterable gear list for a class (by slot, faction, or priority).')
  .addStringOption((o) =>
    o.setName('class').setDescription('Which class').setRequired(true).setAutocomplete(true)
  )
  .addStringOption((o) =>
    o.setName('slot').setDescription('Filter by gear slot').setRequired(false).setAutocomplete(true)
  )
  .addStringOption((o) =>
    o
      .setName('faction')
      .setDescription('Filter by faction usability')
      .setRequired(false)
      .addChoices(
        { name: 'Alliance', value: 'alliance' },
        { name: 'Horde', value: 'horde' },
        { name: 'Both (faction-agnostic)', value: 'both' }
      )
  )
  .addStringOption((o) =>
    o
      .setName('priority')
      .setDescription('Filter by priority')
      .setRequired(false)
      .addChoices(
        { name: 'Core', value: 'core' },
        { name: 'Situational', value: 'situational' },
        { name: 'Budget', value: 'budget' }
      )
  );

export async function execute(interaction) {
  const bracket = await resolveBracket(interaction);
  const className = interaction.options.getString('class');
  const slot = interaction.options.getString('slot');
  const faction = interaction.options.getString('faction');
  const priority = interaction.options.getString('priority');
  const store = await getContentStore();
  const payload = renderGear({ store, bracket, className, slot, faction, priority });
  await interaction.reply({ ...payload, allowedMentions: { parse: [] } });
}

export async function autocomplete(interaction) {
  const focused = interaction.options.getFocused(true);
  const typed = String(focused.value ?? '').toLowerCase();
  const bracket = await resolveBracket(interaction);
  const store = await getContentStore();
  const pool = focused.name === 'slot' ? gearSlots(store, bracket) : listGearClasses(store, bracket);
  const choices = pool
    .filter((v) => v.toLowerCase().includes(typed))
    .slice(0, 25)
    .map((v) => ({ name: capitalize(v), value: v }));
  await interaction.respond(choices);
}
