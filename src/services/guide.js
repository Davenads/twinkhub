import { EmbedBuilder } from 'discord.js';
import { bracketGuides, guidesFor, classIcon, listClassNames } from '../content/store.js';
import { capitalize } from '../lib/text.js';
import { EMBED_COLOR, LIMITS, truncate, field, metaTitle, metaFooter, degradeEmbed } from '../lib/embed.js';

// One embed page groups this many sections. Discord allows 25 fields, but a
// smaller page keeps a long guide readable; the same render function backs both
// the slash command's `page` option and (later, P4) the panel's page buttons.
const SECTIONS_PER_PAGE = 5;
const MAX_FIELDS = 25;

/**
 * Prefix each **bolded class name** in a section body with that class's icon
 * emoji, so class-heavy guides (roles/composition) read with the same visual
 * cue as the tier list. Substitution is content-driven: any authored bracket
 * class whose bolded name appears gets its icon, and a class with no filled
 * emoji id (`classIcon` returns '') is left untouched. No emoji ids live in the
 * guide JSON — the render resolves them, matching the tierlist pattern.
 */
function withClassIcons(store, bracket, text) {
  let out = String(text ?? '');
  for (const cls of listClassNames(store, bracket)) {
    const icon = classIcon(store, cls);
    if (!icon) continue;
    const Name = capitalize(cls);
    out = out.replaceAll(`**${Name}**`, `${icon} **${Name}**`);
  }
  return out;
}

/**
 * Render one guide as a paginated embed. Pagination is stateless: the caller
 * passes a 1-based `page` (from the `/guide page:` option today, from a button's
 * customId once the P4 component router lands) and gets that page's sections as
 * embed fields, with a footer that names the total and points at the next page.
 * All copy lives in the content store; this only slices and formats it.
 *
 * @param {{ store: object, bracket: string, slug: string, page?: number }} args
 * @returns {{ embeds: EmbedBuilder[] }}
 */
export function renderGuide({ store, bracket, slug, page = 1 }) {
  const meta = store?.brackets?.[bracket]?.meta;
  const guides = bracketGuides(store, bracket);
  const slugKey = String(slug ?? '').toLowerCase();

  if (!guides) {
    return { embeds: [degradeEmbed('Guide', `No guides are loaded for bracket **${bracket}**.`)] };
  }

  const body = guides.bySlug[slugKey];
  if (!body) {
    const listed = guides.list.some((g) => String(g.slug).toLowerCase() === slugKey);
    return {
      embeds: [
        degradeEmbed(
          'Guide',
          listed
            ? `The guide **${slugKey}** is catalogued but not authored yet.`
            : `No guide with slug **${slugKey}** in bracket **${bracket}**. Run \`/guide\` with no slug to browse.`
        )
      ]
    };
  }

  const sections = body.sections;
  const totalPages = Math.max(1, Math.ceil(sections.length / SECTIONS_PER_PAGE));
  const current = Math.min(Math.max(1, Math.trunc(Number(page)) || 1), totalPages);
  const start = (current - 1) * SECTIONS_PER_PAGE;

  const embed = new EmbedBuilder().setColor(EMBED_COLOR).setTitle(truncate(body.title, LIMITS.title));
  if (current === 1 && body.summary) embed.setDescription(truncate(body.summary, LIMITS.description));
  for (const s of sections.slice(start, start + SECTIONS_PER_PAGE)) {
    embed.addFields(field(s.heading, withClassIcons(store, bracket, s.body)));
  }

  const footer = [];
  if (totalPages > 1) {
    let t = `Page ${current}/${totalPages}`;
    if (current < totalPages) t += ` \u2014 next: /guide slug:${body.slug} page:${current + 1}`;
    footer.push(t);
  }
  const footerText = metaFooter(meta, footer);
  if (footerText) embed.setFooter({ text: footerText });

  return { embeds: [embed] };
}

/**
 * Render the guide catalogue as a directory embed, optionally filtered by class
 * and/or tag. Each entry shows its slug (to open with `/guide slug:`), its
 * summary, and its tags; catalogued-but-unauthored guides are marked. Backs the
 * no-slug browse path of `/guide`.
 *
 * @param {{ store: object, bracket: string, className?: string|null, tag?: string|null }} args
 * @returns {{ embeds: EmbedBuilder[] }}
 */
export function renderGuideIndex({ store, bracket, className = null, tag = null }) {
  const meta = store?.brackets?.[bracket]?.meta;
  const guides = bracketGuides(store, bracket);

  if (!guides) {
    return { embeds: [degradeEmbed('Guides', `No guides are loaded for bracket **${bracket}**.`)] };
  }

  const matches = guidesFor(store, bracket, { className, tag });
  if (!matches.length) {
    return { embeds: [degradeEmbed(metaTitle('Guides', meta), 'No guides match those filters.')] };
  }

  const embed = new EmbedBuilder().setColor(EMBED_COLOR).setTitle(metaTitle('Guides', meta));

  const desc = [];
  if (guides.note) desc.push(guides.note);
  desc.push('Open one with `/guide slug:<slug>`.');
  embed.setDescription(truncate(desc.join('\n\n'), LIMITS.description));

  for (const g of matches.slice(0, MAX_FIELDS)) {
    const authored = Boolean(guides.bySlug[String(g.slug).toLowerCase()]);
    const tags = (g.tags ?? []).length ? ` \u2014 _${g.tags.join(', ')}_` : '';
    embed.addFields(field(g.title, `\`${g.slug}\`${authored ? '' : ' (coming soon)'} \u2014 ${g.summary}${tags}`));
  }

  const extra = matches.length > MAX_FIELDS ? [`Showing ${MAX_FIELDS} of ${matches.length}. Filter with class or tag.`] : [];
  const footerText = metaFooter(meta, extra);
  if (footerText) embed.setFooter({ text: footerText });

  return { embeds: [embed] };
}
