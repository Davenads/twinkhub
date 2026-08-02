import { capitalize } from '../lib/text.js';

// Best picks first within a slot.
export const PRIORITY_RANK = { core: 0, situational: 1, budget: 2 };

/** The item's Wowhead Classic page URL. Single source of truth, shared with `/item`. */
export function wowheadItemUrl(id) {
  return `https://www.wowhead.com/classic/item=${id}`;
}

/**
 * The item's display name as bold markup, wrapped in a masked link to its Wowhead
 * page when the item carries a `wowheadId`. Discord renders `[text](url)` links in
 * embed field values (where every gear name lives), so `/bis` and `/gear` names are
 * clickable. Items without an id degrade to plain bold — never a broken link.
 */
export function itemNameMarkup(item) {
  return item.wowheadId != null
    ? `**[${item.name}](${wowheadItemUrl(item.wowheadId)})**`
    : `**${item.name}**`;
}

/**
 * An enchant's Wowhead Classic page URL, or `null` when it carries no reference.
 * Unlike items, enchants span two namespaces — profession enchants are `spell=`
 * pages, while applied items (Naxx inscriptions, Dire Maul arcanums, scopes,
 * spikes, chains) are `item=` pages — so each enchant records a
 * `wowhead: { type, id }` discriminator rather than a bare id.
 */
export function enchantWowheadUrl(ench) {
  const ref = ench?.wowhead;
  return ref?.type && ref?.id != null ? `https://www.wowhead.com/classic/${ref.type}=${ref.id}` : null;
}

/**
 * An enchant's display name as italic markup, wrapped in a masked link to its
 * Wowhead page when the enchant carries a resolvable `wowhead` reference. Italic
 * matches how `/bis` renders the per-slot enchant; enchants without a reference
 * degrade to plain italic — never a broken link. Empty string for no enchant.
 */
export function enchantNameMarkup(ench) {
  if (!ench) return '';
  const url = enchantWowheadUrl(ench);
  return url ? `_[${ench.name}](${url})_` : `_${ench.name}_`;
}

/** "+6 Agility, +6 Stamina" from a stats object, or "" when absent. */
export function statLine(stats) {
  if (!stats) return '';
  return Object.entries(stats)
    .map(([k, v]) => `+${v} ${capitalize(k)}`)
    .join(', ');
}

/**
 * One compact display line for a gear item, tagging faction and non-core
 * priority. A trailing italic marker (`_enchant, 2 alts_`) hints when the item
 * carries the fuller P3 detail — a recommended enchant and/or alternatives —
 * that `/item` spells out, so `/bis` and `/gear` point the way without bloating.
 */
export function itemLine(item) {
  let head = itemNameMarkup(item);
  if (item.faction && item.faction !== 'both') head += ` [${item.faction}]`;
  if (item.priority && item.priority !== 'core') head += ` (${item.priority})`;
  const bits = [];
  const s = statLine(item.stats);
  if (s) bits.push(s);
  if (item.source) bits.push(`${item.source.type}: ${item.source.detail}`);
  const tags = [];
  if (item.enchant) tags.push('enchant');
  const altCount = item.alternatives?.length ?? 0;
  if (altCount) tags.push(`${altCount} alt${altCount === 1 ? '' : 's'}`);
  if (tags.length) bits.push(`_${tags.join(', ')}_`);
  return bits.length ? `${head} \u2014 ${bits.join(' \u00b7 ')}` : head;
}

/**
 * One display line for a build's slot pick: item name (with faction / non-core
 * tags) plus the per-(build, slot) enchant spelled out — unlike `itemLine`, the
 * enchant here comes from the build, not the item record. Used by `/bis`'s build
 * view where each slot names an exact loadout choice.
 *
 * @param {object} item resolved gear item
 * @param {object|null} [ench] resolved enchant record for this slot (name + optional wowhead ref)
 * @returns {string}
 */
export function buildItemLine(item, ench = null) {
  let head = itemNameMarkup(item);
  if (item.faction && item.faction !== 'both') head += ` [${item.faction}]`;
  if (item.priority && item.priority !== 'core') head += ` (${item.priority})`;
  const em = enchantNameMarkup(ench);
  if (em) head += ` \u2014 ${em}`;
  return head;
}

/**
 * Group items by slot in the gear index's declared order (unknown slots appended
 * alphabetically), core-first within each slot, and return Discord embed field
 * objects — capped at `maxFields`. Shared by `/bis` and `/gear`.
 *
 * @param {object[]} items
 * @param {string[]} slotOrder
 * @param {number} [maxFields]
 * @returns {{ name: string, value: string }[]}
 */
export function slotFields(items, slotOrder, maxFields = 25) {
  const bySlot = new Map();
  for (const it of items) {
    if (!bySlot.has(it.slot)) bySlot.set(it.slot, []);
    bySlot.get(it.slot).push(it);
  }
  const rank = (s) => {
    const i = slotOrder.indexOf(s);
    return i === -1 ? slotOrder.length : i;
  };
  const ordered = [...bySlot.keys()].sort((a, b) => rank(a) - rank(b) || a.localeCompare(b));
  return ordered.slice(0, maxFields).map((s) => ({
    name: capitalize(s),
    value: bySlot
      .get(s)
      .sort((a, b) => (PRIORITY_RANK[a.priority] ?? 3) - (PRIORITY_RANK[b.priority] ?? 3))
      .map(itemLine)
      .join('\n')
  }));
}
