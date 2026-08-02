import { EmbedBuilder } from 'discord.js';
import { capitalize } from '../lib/text.js';
import {
  bracketGear,
  gearForClass,
  gearSlots,
  buildsForClass,
  getGearItem,
  getEnchant
} from '../content/store.js';
import { slotFields, buildItemLine } from './gearFormat.js';

const EMBED_COLOR = 0xc8aa6e;

/**
 * Render a class's best-in-slot gear. When the class has authored role builds
 * (multi-loadout model), render one chosen build's per-slot loadout — the class
 * default when none is named — with each slot's item + its per-(build, slot)
 * enchant, and point at the other builds. When the class has only a flat item
 * list (no builds authored yet), fall back to the legacy grouped-by-slot view.
 * Optionally narrowed to one slot. All copy is content data. Shared by `/bis`
 * and, later, the gear panel.
 *
 * @param {{ store: object, bracket: string, className: string, build?: string|null, slot?: string|null }} args
 * @returns {{ embeds: EmbedBuilder[] }}
 */
export function renderBis({ store, bracket, className, build: buildId = null, slot = null }) {
  const gear = bracketGear(store, bracket);
  const meta = store?.brackets?.[bracket]?.meta;
  const key = String(className ?? '').toLowerCase();

  const degrade = (msg) => ({
    embeds: [new EmbedBuilder().setColor(EMBED_COLOR).setTitle('Best in Slot').setDescription(msg)]
  });

  if (!gear) return degrade(`No gear data is loaded for bracket **${bracket}**.`);

  // Prefer the multi-build view when the class has authored builds.
  const builds = Array.isArray(gear.builds) ? buildsForClass(store, bracket, key) : [];
  if (builds.length) {
    return renderBuildView({ store, bracket, meta, key, builds, buildId, slot, degrade });
  }

  // Legacy flat-list fallback: a class with items but no builds authored yet.
  const forClass = gearForClass(store, bracket, key);
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

/**
 * Render one role build's loadout: the named build (matched by id or name),
 * else the class default. One embed field per declared slot the build fills,
 * dual picks (finger/trinket) shown as separate lines, each with its enchant.
 */
function renderBuildView({ store, bracket, meta, key, builds, buildId, slot, degrade }) {
  let chosen;
  if (buildId) {
    const q = String(buildId).toLowerCase();
    chosen = builds.find((b) => b.id.toLowerCase() === q || b.name.toLowerCase() === q);
    if (!chosen) {
      return degrade(
        `No build **${buildId}** is authored for **${capitalize(key)}** in bracket **${bracket}**.`
      );
    }
  } else {
    chosen = builds.find((b) => b.default === true) ?? builds[0];
  }

  const slotOrder = gearSlots(store, bracket);
  const slotKey = slot ? String(slot).toLowerCase() : null;

  const fields = [];
  for (const s of slotOrder) {
    if (slotKey && s !== slotKey) continue;
    const val = chosen.slots[s];
    if (!val) continue;
    const picks = Array.isArray(val) ? val : [val];
    const lines = picks
      .map((p) => {
        const item = getGearItem(store, bracket, p.item);
        if (!item) return null;
        const ench = p.enchant ? getEnchant(store, bracket, p.enchant) : null;
        return buildItemLine(item, ench);
      })
      .filter(Boolean);
    if (lines.length) fields.push({ name: capitalize(s), value: lines.join('\n') });
  }

  const metaSuffix = meta ? ` (${meta.battleground} ${meta.levelCap})` : '';
  const title = `Best in Slot \u2014 ${capitalize(key)} \u00b7 ${chosen.name}${metaSuffix}`;
  const embed = new EmbedBuilder().setColor(EMBED_COLOR).setTitle(title);

  if (!fields.length) {
    embed.setDescription(
      slotKey
        ? `No **${slotKey}** pick in the ${chosen.name} build for ${capitalize(key)}.`
        : `No slots listed in the ${chosen.name} build for ${capitalize(key)}.`
    );
    return { embeds: [embed] };
  }

  const header = [`${capitalize(chosen.role)} loadout`];
  if (chosen.faction && chosen.faction !== 'both') header.push(`(${chosen.faction})`);
  let desc = `${header.join(' ')}.`;
  const others = builds.filter((b) => b.id !== chosen.id).map((b) => b.name);
  if (others.length) desc += ` Other builds: ${others.join(', ')} \u2014 add \`build:\` to switch.`;
  embed.setDescription(desc);

  embed.addFields(fields.slice(0, 25));

  if (meta?.gameVersion?.clientPatch) {
    embed.setFooter({ text: `WoW Classic Era ${meta.gameVersion.clientPatch}` });
  }

  return { embeds: [embed] };
}
