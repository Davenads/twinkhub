import { SlashCommandBuilder } from 'discord.js';
import { getContentStore, listTalentClasses, talentsForClass } from '../../content/store.js';
import { resolveBracket } from '../../content/bracket.js';
import { renderTalents } from '../../services/talents.js';
import { capitalize } from '../../lib/text.js';

export const data = new SlashCommandBuilder()
  .setName('talents')
  .setDescription('Level-19 WSG PvP talent builds for a class.')
  .addStringOption((o) =>
    o.setName('class').setDescription('Which class').setRequired(true).setAutocomplete(true)
  )
  .addStringOption((o) =>
    o.setName('build').setDescription('A specific build (optional; defaults to all)').setAutocomplete(true)
  );

export async function execute(interaction) {
  const bracket = await resolveBracket(interaction);
  const className = interaction.options.getString('class');
  const build = interaction.options.getString('build');
  const store = await getContentStore();
  const payload = renderTalents({ store, bracket, className, build });
  await interaction.reply({ ...payload, allowedMentions: { parse: [] } });
}

export async function autocomplete(interaction) {
  const focused = interaction.options.getFocused(true);
  const bracket = await resolveBracket(interaction);
  const store = await getContentStore();

  if (focused.name === 'class') {
    const typed = String(focused.value ?? '').toLowerCase();
    const choices = listTalentClasses(store, bracket)
      .filter((c) => c.toLowerCase().includes(typed))
      .slice(0, 25)
      .map((c) => ({ name: capitalize(c), value: c }));
    await interaction.respond(choices);
    return;
  }

  // build autocomplete: scope to the class already chosen (if any).
  const className = interaction.options.getString('class');
  const typed = String(focused.value ?? '').toLowerCase();
  const builds = className ? (talentsForClass(store, bracket, className) ?? []) : [];
  const choices = builds
    .filter((b) => b.name.toLowerCase().includes(typed) || b.id.toLowerCase().includes(typed))
    .slice(0, 25)
    .map((b) => ({ name: b.name.slice(0, 100), value: b.id }));
  await interaction.respond(choices);
}
