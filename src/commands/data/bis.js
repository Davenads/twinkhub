import { SlashCommandBuilder } from 'discord.js';
import { getContentStore, listGearClasses, gearSlots, buildsForClass } from '../../content/store.js';
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
    o
      .setName('faction')
      .setDescription('Which faction (defaults to Horde)')
      .setRequired(false)
      .addChoices({ name: 'Alliance', value: 'alliance' }, { name: 'Horde', value: 'horde' })
  )
  .addStringOption((o) =>
    o
      .setName('build')
      .setDescription('Which role build (defaults to the class default)')
      .setRequired(false)
      .setAutocomplete(true)
  )
  .addStringOption((o) =>
    o.setName('slot').setDescription('Filter to one gear slot').setRequired(false).setAutocomplete(true)
  );

export async function execute(interaction) {
  const bracket = await resolveBracket(interaction);
  const className = interaction.options.getString('class');
  const faction = interaction.options.getString('faction');
  const build = interaction.options.getString('build');
  const slot = interaction.options.getString('slot');
  const store = await getContentStore();
  const payload = renderBis({ store, bracket, className, build, slot, faction });

  await interaction.reply({ ...payload, allowedMentions: { parse: [] } });
}

export async function autocomplete(interaction) {
  const focused = interaction.options.getFocused(true);
  const typed = focused.value.toLowerCase();
  const bracket = await resolveBracket(interaction);
  const store = await getContentStore();

  // `build` autocompletes to the chosen class's role builds (by id, labelled by
  // name); it needs the sibling `class` option to know which builds to offer.
  if (focused.name === 'build') {
    const className = interaction.options.getString('class');
    const faction = String(interaction.options.getString('faction') ?? '').toLowerCase();
    let builds = className ? buildsForClass(store, bracket, className) : [];
    // When a faction is already chosen, only offer that side's builds so the
    // otherwise-identical build names (Offense/Midfield/Defense) aren't ambiguous.
    if (faction === 'horde' || faction === 'alliance') {
      builds = builds.filter((b) => (b.faction ?? 'both') === faction || (b.faction ?? 'both') === 'both');
    }
    const choices = builds
      .filter((b) => b.name.toLowerCase().includes(typed) || b.id.toLowerCase().includes(typed))
      .slice(0, 25)
      .map((b) => ({
        // Label with faction so the duplicate role names are distinguishable.
        name: `${b.name} \u00b7 ${capitalize(b.faction ?? 'both')}${b.default ? ' (default)' : ''}`,
        value: b.id
      }));
    await interaction.respond(choices);
    return;
  }

  const pool =
    focused.name === 'slot' ? gearSlots(store, bracket) : listGearClasses(store, bracket);
  const choices = pool
    .filter((v) => v.toLowerCase().includes(typed))
    .slice(0, 25)
    .map((v) => ({ name: capitalize(v), value: v }));

  await interaction.respond(choices);
}
