import { SlashCommandBuilder } from 'discord.js';
import { getContentStore, listClassNames, listGuides } from '../../content/store.js';
import { resolveBracket } from '../../content/bracket.js';
import { renderGuide, renderGuideIndex } from '../../services/guide.js';
import { capitalize } from '../../lib/text.js';

// Enduser data command — open to everyone. With a `slug` it opens that guide
// (paginated via the stateless `page` option; P4 panels will drive the same
// render with buttons). With no slug it browses the catalogue, optionally
// filtered by `class` or `tag`. All copy lives in the content store.
export const data = new SlashCommandBuilder()
  .setName('guide')
  .setDescription('Open a curated guide, or browse the catalogue by class or tag.')
  .addStringOption((o) =>
    o.setName('slug').setDescription('Which guide to open').setRequired(false).setAutocomplete(true)
  )
  .addStringOption((o) =>
    o.setName('class').setDescription('Browse guides for a class').setRequired(false).setAutocomplete(true)
  )
  .addStringOption((o) => o.setName('tag').setDescription('Browse guides with a tag').setRequired(false))
  .addIntegerOption((o) =>
    o.setName('page').setDescription('Page of a long guide (default 1)').setRequired(false).setMinValue(1)
  );

export async function execute(interaction) {
  const bracket = await resolveBracket(interaction);
  const slug = interaction.options.getString('slug');
  const className = interaction.options.getString('class');
  const tag = interaction.options.getString('tag');
  const page = interaction.options.getInteger('page') ?? 1;
  const store = await getContentStore();
  const payload = slug
    ? renderGuide({ store, bracket, slug, page })
    : renderGuideIndex({ store, bracket, className, tag });

  await interaction.reply({ ...payload, allowedMentions: { parse: [] } });
}

export async function autocomplete(interaction) {
  const focused = interaction.options.getFocused(true);
  const bracket = await resolveBracket(interaction);
  const store = await getContentStore();
  const typed = String(focused.value ?? '').toLowerCase();

  if (focused.name === 'class') {
    const choices = listClassNames(store, bracket)
      .filter((c) => c.includes(typed))
      .slice(0, 25)
      .map((c) => ({ name: capitalize(c), value: c }));
    await interaction.respond(choices);
    return;
  }

  // Default focused option: slug. Match on slug or title, label with the title.
  const choices = listGuides(store, bracket)
    .filter((g) => String(g.slug).toLowerCase().includes(typed) || String(g.title).toLowerCase().includes(typed))
    .slice(0, 25)
    .map((g) => ({ name: g.title.length > 100 ? `${g.title.slice(0, 99)}\u2026` : g.title, value: g.slug }));
  await interaction.respond(choices);
}
