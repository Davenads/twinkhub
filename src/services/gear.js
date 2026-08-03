import { ActionRowBuilder, ButtonBuilder, ButtonStyle } from 'discord.js';
import { capitalize } from '../lib/text.js';
import { bracketGear, gearForClass, gearSlots } from '../content/store.js';
import { slotFields } from './gearFormat.js';
import { EMBED_COLOR, field, metaTitle, metaFooter, degradeEmbed } from '../lib/embed.js';
import { paginateFields } from '../lib/paginate.js';
import { encodeCustomId } from './panels.js';

/**
 * A faction filter shows what that faction can actually use: its own items plus
 * faction-agnostic ("both") ones. Selecting "both" narrows to faction-agnostic
 * items only.
 */
function factionMatches(itemFaction, filter) {
  if (!filter) return true;
  if (filter === 'both') return itemFaction === 'both';
  return itemFaction === filter || itemFaction === 'both';
}

/** Encode a filter value for a page-nav customId; null/empty becomes '-'. */
const slug = (v) => (v ? String(v).toLowerCase() : '-');

/**
 * Prev/Next nav row for a paged `/gear` result. Each button re-encodes the full
 * query (class + filters) plus its target page in the customId, so paging is
 * stateless — the component handler just re-runs `renderGearPage` for that page.
 * Buttons clamp at the ends and disable there.
 */
function gearNav({ className, slot, faction, priority, page, pageCount }) {
  const id = (p) => encodeCustomId('gearpage', slug(className), slug(slot), slug(faction), slug(priority), String(p));
  const prev = new ButtonBuilder()
    .setCustomId(id(Math.max(0, page - 1)))
    .setLabel('\u25C0 Prev')
    .setStyle(ButtonStyle.Secondary)
    .setDisabled(page <= 0);
  const next = new ButtonBuilder()
    .setCustomId(id(Math.min(pageCount - 1, page + 1)))
    .setLabel('Next \u25B6')
    .setStyle(ButtonStyle.Secondary)
    .setDisabled(page >= pageCount - 1);
  return new ActionRowBuilder().addComponents(prev, next);
}

/**
 * Render a class's gear filtered by slot, faction usability, and/or priority
 * (core/situational/budget). Same slot grouping as `/bis` but filter-driven —
 * the differentiator is the faction/priority narrowing. All copy is content data.
 *
 * Delegates to `renderGearPage` at page 0. A broad/unfiltered result overruns
 * Discord's 6000-char per-message embed cap, so the result is paginated; when it
 * spans multiple pages the payload carries Prev/Next controls.
 *
 * @param {{ store: object, bracket: string, className: string,
 *          slot?: string|null, faction?: string|null, priority?: string|null }} args
 * @returns {{ embeds: import('discord.js').EmbedBuilder[], components?: ActionRowBuilder[] }}
 */
export function renderGear(args) {
  return renderGearPage({ ...args, page: 0 });
}

/**
 * Render one page of a `/gear` result. Identical filtering to `renderGear`; the
 * assembled slot fields are split into 6000-cap-safe pages and the requested
 * (clamped) page is returned, with a Prev/Next row when more than one page
 * exists. Degrade/empty states are single-page and carry no controls. Shared by
 * the `/gear` command (page 0) and the paginator's component handler.
 *
 * @param {{ store: object, bracket: string, className: string, slot?: string|null,
 *          faction?: string|null, priority?: string|null, page?: number }} args
 * @returns {{ embeds: import('discord.js').EmbedBuilder[], components?: ActionRowBuilder[] }}
 */
export function renderGearPage({ store, bracket, className, slot = null, faction = null, priority = null, page = 0 }) {
  const gear = bracketGear(store, bracket);
  const meta = store?.brackets?.[bracket]?.meta;
  const forClass = gearForClass(store, bracket, className);

  const degrade = (msg) => ({ embeds: [degradeEmbed('Gear', msg)] });

  if (!gear) return degrade(`No gear data is loaded for bracket **${bracket}**.`);
  if (!forClass) {
    return degrade(
      `No gear list is authored for **${capitalize(String(className))}** in bracket **${bracket}** yet.`
    );
  }

  const slotKey = slot ? String(slot).toLowerCase() : null;
  const factionKey = faction ? String(faction).toLowerCase() : null;
  const priorityKey = priority ? String(priority).toLowerCase() : null;

  const items = forClass.items.filter(
    (i) =>
      (!slotKey || i.slot.toLowerCase() === slotKey) &&
      factionMatches(i.faction, factionKey) &&
      (!priorityKey || i.priority === priorityKey)
  );

  const scope = [
    slotKey ? `slot **${slotKey}**` : null,
    factionKey ? `faction **${factionKey}**` : null,
    priorityKey ? `priority **${priorityKey}**` : null
  ].filter(Boolean);

  const title = metaTitle(`Gear \u2014 ${capitalize(forClass.className)}`, meta);

  if (!items.length) {
    return {
      embeds: [
        degradeEmbed(
          title,
          scope.length
            ? `No gear matches ${scope.join(' and ')} for ${capitalize(forClass.className)}.`
            : `No gear listed for ${capitalize(forClass.className)}.`
        )
      ]
    };
  }

  const fields = slotFields(items, gearSlots(store, bracket)).map((f) => field(f.name, f.value));
  const pages = paginateFields({
    title,
    description: scope.length ? `Filtered to ${scope.join(' and ')}.` : '',
    footer: metaFooter(meta) ?? '',
    fields,
    color: EMBED_COLOR
  });

  const idx = Math.min(Math.max(0, Number(page) || 0), pages.length - 1);
  const payload = { embeds: [pages[idx]] };
  if (pages.length > 1) {
    payload.components = [gearNav({ className, slot, faction, priority, page: idx, pageCount: pages.length })];
  }
  return payload;
}
