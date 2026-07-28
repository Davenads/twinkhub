import { EmbedBuilder } from 'discord.js';
import { capitalize } from '../lib/text.js';
import { bracketGear, gearForClass, gearSlots } from '../content/store.js';
import { slotFields } from './gearFormat.js';

const EMBED_COLOR = 0xc8aa6e;

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
  embed.addFields(slotFields(items, gearSlots(store, bracket)));

  if (meta?.gameVersion?.clientPatch) {
    embed.setFooter({ text: `WoW Classic Era ${meta.gameVersion.clientPatch}` });
  }

  return { embeds: [embed] };
}
