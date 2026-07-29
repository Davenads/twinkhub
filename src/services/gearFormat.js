import { capitalize } from '../lib/text.js';

// Best picks first within a slot.
export const PRIORITY_RANK = { core: 0, situational: 1, budget: 2 };

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
  let head = `**${item.name}**`;
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
