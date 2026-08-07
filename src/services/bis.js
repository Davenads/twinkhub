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
import {
  EMBED_COLOR,
  LIMITS,
  truncate,
  field,
  metaTitle,
  metaFooter,
  degradeEmbed
} from '../lib/embed.js';

/**
 * Render a class's best-in-slot gear. When the class has authored role builds
 * (multi-loadout model), render one chosen build's per-slot loadout — the class
 * default when none is named — with each slot's item + its per-(build, slot)
 * enchant, and point at the other builds. When the class has only a flat item
 * list (no builds authored yet), fall back to the legacy grouped-by-slot view.
 * Optionally narrowed to one slot. All copy is content data. Shared by `/bis`
 * and, later, the gear panel.
 *
 * @param {{ store: object, bracket: string, className: string, build?: string|null, slot?: string|null, faction?: string|null }} args
 * @returns {{ embeds: EmbedBuilder[] }}
 */
export function renderBis({
  store,
  bracket,
  className,
  build: buildId = null,
  slot = null,
  faction = null
}) {
  const gear = bracketGear(store, bracket);
  const meta = store?.brackets?.[bracket]?.meta;
  const key = String(className ?? '').toLowerCase();

  const degrade = (msg) => ({ embeds: [degradeEmbed('Best in Slot', msg)] });

  if (!gear) return degrade(`No gear data is loaded for bracket **${bracket}**.`);

  // Prefer the multi-build view when the class has authored builds.
  const builds = Array.isArray(gear.builds) ? buildsForClass(store, bracket, key) : [];
  if (builds.length) {
    return renderBuildView({ store, bracket, meta, key, builds, buildId, slot, faction, degrade });
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

  const title = metaTitle(`Best in Slot \u2014 ${capitalize(forClass.className)}`, meta);

  if (!items.length) {
    return {
      embeds: [
        degradeEmbed(
          title,
          slotKey
            ? `No **${slotKey}** items listed for ${capitalize(forClass.className)}.`
            : `No items listed for ${capitalize(forClass.className)}.`
        )
      ]
    };
  }

  const embed = new EmbedBuilder().setColor(EMBED_COLOR).setTitle(title);
  if (gear.index?.notes) embed.setDescription(truncate(gear.index.notes, LIMITS.description));
  embed.addFields(slotFields(items, gearSlots(store, bracket)).map((f) => field(f.name, f.value)));

  const footerText = metaFooter(meta);
  if (footerText) embed.setFooter({ text: footerText });

  return { embeds: [embed] };
}

/** Normalize a faction arg to `'horde' | 'alliance'`, else null. */
function normFaction(f) {
  const s = String(f ?? '').toLowerCase();
  return s === 'horde' || s === 'alliance' ? s : null;
}

const buildFaction = (b) => b.faction ?? 'both';

/**
 * Render one role build's loadout: the named build (matched by id or name),
 * else the faction default. `faction` picks which side's builds to consider
 * (the store defaults to Horde since only Horde builds carry `default: true`);
 * an explicit `build` id/name still wins. One embed field per declared slot the
 * build fills, dual picks (finger/trinket) shown as separate lines with enchants.
 */
function renderBuildView({ store, bracket, meta, key, builds, buildId, slot, faction, degrade }) {
  const fac = normFaction(faction);
  let chosen;
  let factionNote = null;

  if (buildId) {
    const q = String(buildId).toLowerCase();
    // An explicit id encodes faction, so match it first; fall back to a name
    // match (preferring the requested faction so a bare name can reach either side).
    chosen = builds.find((b) => b.id.toLowerCase() === q);
    if (!chosen) {
      const pool = fac ? builds.filter((b) => buildFaction(b) === fac) : builds;
      chosen =
        pool.find((b) => b.name.toLowerCase() === q) ??
        builds.find((b) => b.name.toLowerCase() === q);
    }
    if (!chosen) {
      return degrade(
        `No build **${buildId}** is authored for **${capitalize(key)}** in bracket **${bracket}**.`
      );
    }
  } else if (fac) {
    const pool = builds.filter((b) => buildFaction(b) === fac || buildFaction(b) === 'both');
    if (pool.length) {
      chosen = pool.find((b) => b.default === true) ?? pool[0];
    } else {
      // Single-faction class asked for the other side: fall back with a note
      // instead of an empty reply (e.g. faction:horde on Alliance-only Paladin).
      chosen = builds.find((b) => b.default === true) ?? builds[0];
      factionNote = `**${capitalize(key)}** has no ${capitalize(fac)} builds \u2014 showing ${capitalize(buildFaction(chosen))}.`;
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
    if (lines.length) fields.push(field(capitalize(s), lines.join('\n')));
  }

  const title = metaTitle(`Best in Slot \u2014 ${capitalize(key)} \u00b7 ${chosen.name}`, meta);

  if (!fields.length) {
    return {
      embeds: [
        degradeEmbed(
          title,
          slotKey
            ? `No **${slotKey}** pick in the ${chosen.name} build for ${capitalize(key)}.`
            : `No slots listed in the ${chosen.name} build for ${capitalize(key)}.`
        )
      ]
    };
  }

  const embed = new EmbedBuilder().setColor(EMBED_COLOR).setTitle(title);

  const header = [`${capitalize(chosen.role)} loadout`];
  if (chosen.faction && chosen.faction !== 'both') header.push(`(${chosen.faction})`);
  let desc = factionNote ? `${factionNote}\n${header.join(' ')}.` : `${header.join(' ')}.`;
  // Only list *other* builds for the same faction as the chosen one, deduped by
  // name — classes with per-faction build pairs otherwise repeat names.
  const chosenFaction = chosen.faction ?? 'both';
  const others = [
    ...new Set(
      builds
        .filter((b) => b.id !== chosen.id)
        .filter((b) => {
          const f = b.faction ?? 'both';
          return f === chosenFaction || f === 'both' || chosenFaction === 'both';
        })
        .map((b) => b.name)
    )
  ];
  if (others.length) desc += ` Other builds: ${others.join(', ')} \u2014 add \`build:\` to switch.`;
  embed.setDescription(truncate(desc, LIMITS.description));

  embed.addFields(fields.slice(0, LIMITS.fields));

  const footerText = metaFooter(meta);
  if (footerText) embed.setFooter({ text: footerText });

  return { embeds: [embed] };
}
