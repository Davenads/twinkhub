import { SlashCommandBuilder } from 'discord.js';
import { getContentStore, listGearClasses, gearSlots } from '../../content/store.js';
import { resolveBracket } from '../../content/bracket.js';
import { renderBis } from '../../services/bis.js';
import { capitalize } from '../../lib/text.js';

// Enduser data command — open to everyone. The flagship command: a class's
// best-in-slot list, grouped by slot, optionally narrowed to one slot. The
// `class` option autocompletes only classes that actually have a BiS authored;
// `slot` autocompletes the bracket's declared gear slots. All copy is data.
export const data = new SlashCommandBuilder()
  .setName('bis')
  .setDescription('Best-in-slot gear for a class.')
  .addStringOption((o) =>
    o.setName('class').setDescription('Which class').setRequired(true).setAutocomplete(true)
  )
  .addStringOption((o) =>
    o.setName('slot').setDescription('Filter to one gear slot').setRequired(false).setAutocomplete(true)
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
  const slot = interaction.options.getString('slot');
  const store = await getContentStore();
  const payload = renderBis({ store, bracket, className, slot });

  await interaction.reply({ ...payload, allowedMentions: { parse: [] } });
}

export async function autocomplete(interaction) {
  const focused = interaction.options.getFocused(true);
  const typed = focused.value.toLowerCase();
  const bracket = await resolveBracket(interaction);
  const store = await getContentStore();

  const pool =
    focused.name === 'slot' ? gearSlots(store, bracket) : listGearClasses(store, bracket);
  const choices = pool
    .filter((v) => v.toLowerCase().includes(typed))
    .slice(0, 25)
    .map((v) => ({ name: capitalize(v), value: v }));

  await interaction.respond(choices);
}
