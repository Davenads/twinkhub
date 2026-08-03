import { ActionRowBuilder, ButtonBuilder, ButtonStyle } from 'discord.js';
import { capitalize } from '../lib/text.js';
import { bracketGear, gearForClass, gearSlots, shoulderStrategyFor } from '../content/store.js';
import { slotFields, itemLine, enchantNameMarkup } from './gearFormat.js';
import { EMBED_COLOR, field, metaTitle, metaFooter, degradeEmbed, fieldsFromLines } from '../lib/embed.js';
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

  // The shoulder slot follows the level-19 vessel meta rather than a flat pick
  // list: one best-armor BoE vessel carrying a role-dependent Scourge inscription.
  // When the class has an authored strategy, render that framed view instead of a
  // bare item list. Falls through to the normal path when none is authored.
  if (slotKey === 'shoulder') {
    const strat = shoulderStrategyFor(store, bracket, className);
    if (strat) return renderShoulderPage({ meta, forClass, strat, className, faction, priority, page });
  }

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

/**
 * Render the shoulder-slot view for a class as the level-19 vessel meta: the
 * best-armor BoE vessel it wears, the Scourge inscription(s) its builds apply to
 * that vessel (grouped by inscription, each listing the builds that use it), and
 * a demoted "other shoulders" note for any off-type pieces the class could wear
 * but shouldn't. Derived from `shoulderStrategyFor`; the mechanic explainer is
 * the embed description. Paginated like the main path and reachable statelessly
 * via the same gearpage nav (customId re-encodes slot `shoulder`).
 *
 * @param {{ meta: object, forClass: object, strat: object, className: string,
 *          faction?: string|null, priority?: string|null, page?: number }} args
 * @returns {{ embeds: import('discord.js').EmbedBuilder[], components?: ActionRowBuilder[] }}
 */
function renderShoulderPage({ meta, forClass, strat, className, faction = null, priority = null, page = 0 }) {
  const title = metaTitle(`Gear \u2014 ${capitalize(forClass.className)} shoulder`, meta);

  const fields = [];
  fields.push(
    field(
      `Vessel \u2014 ${capitalize(strat.armorType)}`,
      strat.vessel ? itemLine(strat.vessel) : `No ${strat.armorType} vessel is mapped.`
    )
  );

  const inscLines = strat.inscriptions.map((ins) => {
    const label = enchantNameMarkup(ins.enchant) || ins.enchant?.name || ins.enchantId;
    const builds = ins.builds.map((b) => `${b.name} (${b.role})`).join(', ');
    return `${label} \u2014 ${builds}`;
  });
  if (inscLines.length) fields.push(...fieldsFromLines('Scourge inscription by build', inscLines));

  const others = forClass.items.filter((i) => i.slot.toLowerCase() === 'shoulder' && i.id !== strat.vessel?.id);
  if (others.length) fields.push(...fieldsFromLines('Other shoulders (not recommended)', others.map(itemLine)));

  const pages = paginateFields({
    title,
    description: strat.note ?? '',
    footer: metaFooter(meta) ?? '',
    fields,
    color: EMBED_COLOR
  });

  const idx = Math.min(Math.max(0, Number(page) || 0), pages.length - 1);
  const payload = { embeds: [pages[idx]] };
  if (pages.length > 1) {
    payload.components = [gearNav({ className, slot: 'shoulder', faction, priority, page: idx, pageCount: pages.length })];
  }
  return payload;
}
