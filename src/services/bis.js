import { EmbedBuilder } from 'discord.js';
import { capitalize } from '../lib/text.js';
import { bracketGear, gearForClass, gearSlots } from '../content/store.js';

const EMBED_COLOR = 0xc8aa6e;
const MAX_FIELDS = 25;
// Best picks first within a slot.
const PRIORITY_RANK = { core: 0, situational: 1, budget: 2 };

function statLine(stats) {
  if (!stats) return '';
  return Object.entries(stats)
    .map(([k, v]) => `+${v} ${capitalize(k)}`)
    .join(', ');
}

function itemLine(item) {
  let head = `**${item.name}**`;
  if (item.faction && item.faction !== 'both') head += ` [${item.faction}]`;
  if (item.priority && item.priority !== 'core') head += ` (${item.priority})`;
  const bits = [];
  const s = statLine(item.stats);
  if (s) bits.push(s);
  if (item.source) bits.push(`${item.source.type}: ${item.source.detail}`);
  return bits.length ? `${head} \u2014 ${bits.join(' \u00b7 ')}` : head;
}

/**
 * Render a class's best-in-slot list, grouped by slot in the gear index's
 * declared order, optionally narrowed to one slot. Merges the shared cross-class
 * items with the class's own picks (see `gearForClass`). All copy is content
 * data. Shared by `/bis` and, later, the gear panel.
 *
 * @param {{ store: object, bracket: string, className: string, slot?: string|null }} args
 * @returns {{ embeds: EmbedBuilder[] }}
 */
export function renderBis({ store, bracket, className, slot = null }) {
  const gear = bracketGear(store, bracket);
  const meta = store?.brackets?.[bracket]?.meta;
  const forClass = gearForClass(store, bracket, className);

  const degrade = (msg) => ({
    embeds: [new EmbedBuilder().setColor(EMBED_COLOR).setTitle('Best in Slot').setDescription(msg)]
  });

  if (!gear) return degrade(`No gear data is loaded for bracket **${bracket}**.`);
  if (!forClass) {
    return degrade(
      `No best-in-slot list is authored for **${capitalize(String(className))}** in bracket **${bracket}** yet.`
    );
  }

  const slotKey = slot ? String(slot).toLowerCase() : null;
  const order = gearSlots(store, bracket);
  const items = forClass.items.filter((i) => !slotKey || i.slot.toLowerCase() === slotKey);

  const title = `Best in Slot \u2014 ${capitalize(forClass.className)}${
    meta ? ` (${meta.battleground} ${meta.levelCap})` : ''
  }`;
  const embed = new EmbedBuilder().setColor(EMBED_COLOR).setTitle(title);

  if (!items.length) {
    embed.setDescription(
      slotKey
        ? `No **${slotKey}** items listed for ${capitalize(forClass.className)}.`
        : `No items listed for ${capitalize(forClass.className)}.`
    );
    return { embeds: [embed] };
  }

  if (gear.index?.notes) embed.setDescription(gear.index.notes);

  // Group by slot, then order slots by the gear index (unknown slots appended).
  const bySlot = new Map();
  for (const it of items) {
    if (!bySlot.has(it.slot)) bySlot.set(it.slot, []);
    bySlot.get(it.slot).push(it);
  }
  const rank = (s) => {
    const i = order.indexOf(s);
    return i === -1 ? order.length : i;
  };
  const orderedSlots = [...bySlot.keys()].sort((a, b) => rank(a) - rank(b) || a.localeCompare(b));

  for (const s of orderedSlots.slice(0, MAX_FIELDS)) {
    const list = bySlot
      .get(s)
      .sort((a, b) => (PRIORITY_RANK[a.priority] ?? 3) - (PRIORITY_RANK[b.priority] ?? 3));
    embed.addFields({ name: capitalize(s), value: list.map(itemLine).join('\n') });
  }

  if (meta?.gameVersion?.clientPatch) {
    embed.setFooter({ text: `WoW Classic Era ${meta.gameVersion.clientPatch}` });
  }

  return { embeds: [embed] };
}
