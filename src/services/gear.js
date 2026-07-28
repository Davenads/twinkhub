import { EmbedBuilder } from 'discord.js';
import { capitalize } from '../lib/text.js';
import { bracketGear, gearForClass, gearSlots } from '../content/store.js';
import { slotFields } from './gearFormat.js';

const EMBED_COLOR = 0xc8aa6e;

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

/**
 * Render a class's gear filtered by slot, faction usability, and/or priority
 * (core/situational/budget). Same slot grouping as `/bis` but filter-driven —
 * the differentiator is the faction/priority narrowing. All copy is content data.
 *
 * @param {{ store: object, bracket: string, className: string,
 *          slot?: string|null, faction?: string|null, priority?: string|null }} args
 * @returns {{ embeds: EmbedBuilder[] }}
 */
export function renderGear({ store, bracket, className, slot = null, faction = null, priority = null }) {
  const gear = bracketGear(store, bracket);
  const meta = store?.brackets?.[bracket]?.meta;
  const forClass = gearForClass(store, bracket, className);

  const degrade = (msg) => ({
    embeds: [new EmbedBuilder().setColor(EMBED_COLOR).setTitle('Gear').setDescription(msg)]
  });

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

  const title = `Gear \u2014 ${capitalize(forClass.className)}${
    meta ? ` (${meta.battleground} ${meta.levelCap})` : ''
  }`;
  const embed = new EmbedBuilder().setColor(EMBED_COLOR).setTitle(title);

  if (!items.length) {
    embed.setDescription(
      scope.length
        ? `No gear matches ${scope.join(' and ')} for ${capitalize(forClass.className)}.`
        : `No gear listed for ${capitalize(forClass.className)}.`
    );
    return { embeds: [embed] };
  }

  if (scope.length) embed.setDescription(`Filtered to ${scope.join(' and ')}.`);
  embed.addFields(slotFields(items, gearSlots(store, bracket)));

  if (meta?.gameVersion?.clientPatch) {
    embed.setFooter({ text: `WoW Classic Era ${meta.gameVersion.clientPatch}` });
  }

  return { embeds: [embed] };
}
