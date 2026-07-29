import { EmbedBuilder } from 'discord.js';
import { bracketGuides, guidesFor } from '../content/store.js';

const EMBED_COLOR = 0xc8aa6e;
// One embed page groups this many sections. Discord allows 25 fields, but a
// smaller page keeps a long guide readable; the same render function backs both
// the slash command's `page` option and (later, P4) the panel's page buttons.
const SECTIONS_PER_PAGE = 5;
const MAX_FIELDS = 25;

const truncate = (s, max) => (s.length > max ? `${s.slice(0, max - 1)}\u2026` : s);

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
  const embed = new EmbedBuilder().setColor(EMBED_COLOR).setTitle('Guide');

  if (!guides) {
    return { embeds: [embed.setDescription(`No guides are loaded for bracket **${bracket}**.`)] };
  }

  const body = guides.bySlug[slugKey];
  if (!body) {
    const listed = guides.list.some((g) => String(g.slug).toLowerCase() === slugKey);
    return {
      embeds: [
        embed.setDescription(
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

  embed.setTitle(truncate(body.title, 256));
  if (current === 1 && body.summary) embed.setDescription(truncate(body.summary, 4096));
  for (const s of sections.slice(start, start + SECTIONS_PER_PAGE)) {
    embed.addFields({ name: truncate(s.heading, 256), value: truncate(s.body, 1024) });
  }

  const footer = [];
  if (totalPages > 1) {
    let t = `Page ${current}/${totalPages}`;
    if (current < totalPages) t += ` \u2014 next: /guide slug:${body.slug} page:${current + 1}`;
    footer.push(t);
  }
  if (meta?.gameVersion?.clientPatch) footer.push(`WoW Classic Era ${meta.gameVersion.clientPatch}`);
  if (footer.length) embed.setFooter({ text: footer.join(' \u00b7 ') });

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
  const embed = new EmbedBuilder()
    .setColor(EMBED_COLOR)
    .setTitle(meta ? `Guides \u2014 ${meta.battleground} ${meta.levelCap}` : 'Guides');

  if (!guides) {
    return { embeds: [embed.setDescription(`No guides are loaded for bracket **${bracket}**.`)] };
  }

  const matches = guidesFor(store, bracket, { className, tag });
  if (!matches.length) {
    return { embeds: [embed.setDescription('No guides match those filters.')] };
  }

  const desc = [];
  if (guides.note) desc.push(guides.note);
  desc.push('Open one with `/guide slug:<slug>`.');
  embed.setDescription(truncate(desc.join('\n\n'), 4096));

  for (const g of matches.slice(0, MAX_FIELDS)) {
    const authored = Boolean(guides.bySlug[String(g.slug).toLowerCase()]);
    const tags = (g.tags ?? []).length ? ` \u2014 _${g.tags.join(', ')}_` : '';
    embed.addFields({
      name: truncate(g.title, 256),
      value: truncate(`\`${g.slug}\`${authored ? '' : ' (coming soon)'} \u2014 ${g.summary}${tags}`, 1024)
    });
  }

  if (matches.length > MAX_FIELDS) {
    embed.setFooter({ text: `Showing ${MAX_FIELDS} of ${matches.length}. Filter with class or tag.` });
  } else if (meta?.gameVersion?.clientPatch) {
    embed.setFooter({ text: `WoW Classic Era ${meta.gameVersion.clientPatch}` });
  }

  return { embeds: [embed] };
}
