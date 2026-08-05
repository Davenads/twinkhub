import { EmbedBuilder } from 'discord.js';
import { capitalize } from '../lib/text.js';
import { bracketEnchants } from '../content/store.js';
import { enchantWowheadUrl } from './gearFormat.js';
import {
  EMBED_COLOR,
  LIMITS,
  truncate,
  field,
  metaTitle,
  metaFooter,
  degradeEmbed,
  addFieldsWithinLimits,
  fieldsFromLines
} from '../lib/embed.js';

// Deliberate slot order for the grouped overview (offense/core slots first),
// independent of JSON authoring order. Slots not listed sort last, then A-Z.
const SLOT_ORDER = [
  'weapon',
  '2h-weapon',
  'shoulder',
  'head-legs',
  'chest',
  'bracer',
  'gloves',
  'boots',
  'cloak',
  'shield',
  'scope'
];

// Display labels for slot keys the plain capitalize() renders awkwardly.
const SLOT_LABELS = {
  'weapon': 'Weapon',
  '2h-weapon': '2H Weapon',
  'head-legs': 'Head / Legs'
};

const slotLabel = (slot) => SLOT_LABELS[slot] ?? capitalize(slot);
const slotRank = (slot) => {
  const i = SLOT_ORDER.indexOf(slot);
  return i === -1 ? SLOT_ORDER.length : i;
};

// Under a slot header the "Enchant <Slot> - " name prefix is pure redundancy, so
// strip it for the grouped lines (leaves prefix-less names like "Might of the
// Scourge" / "Accurate Scope" untouched).
const shortName = (name) => name.replace(/^Enchant .+? - /, '');

/**
 * Render the bracket's enchants, optionally filtered by slot and/or class. The
 * `noLevelReq` flag is surfaced prominently because the entire twink enchant
 * meta hinges on it. All copy comes from `enchants.json`; shared by `/enchant`
 * and, later, the reference panel.
 *
 * @param {{ store: object, bracket: string, slot?: string|null, className?: string|null }} args
 * @returns {{ embeds: EmbedBuilder[] }}
 */
export function renderEnchant({ store, bracket, slot = null, className = null }) {
  const data = bracketEnchants(store, bracket);
  const meta = store?.brackets?.[bracket]?.meta;

  if (!data) {
    return { embeds: [degradeEmbed('Enchants', `No enchant data is loaded for bracket **${bracket}**.`)] };
  }

  const slotKey = slot ? String(slot).toLowerCase() : null;
  const classKey = className ? String(className).toLowerCase() : null;

  const matches = data.enchants.filter(
    (e) =>
      (!slotKey || e.slot.toLowerCase() === slotKey) &&
      (!classKey || e.classes.some((c) => c.toLowerCase() === classKey))
  );

  const scope = [
    slotKey ? `slot **${slotKey}**` : null,
    classKey ? `class **${capitalize(classKey)}**` : null
  ].filter(Boolean);

  if (!matches.length) {
    return {
      embeds: [
        degradeEmbed(
          metaTitle('Enchants', meta),
          scope.length
            ? `No enchants match ${scope.join(' and ')} in bracket **${bracket}**.`
            : `No enchants are authored for bracket **${bracket}**.`
        )
      ]
    };
  }

  const embed = new EmbedBuilder().setColor(EMBED_COLOR).setTitle(metaTitle('Enchants', meta));

  const descParts = [];
  if (scope.length) descParts.push(`Filtered to ${scope.join(' and ')}.`);
  if (data.note) descParts.push(data.note);
  if (descParts.length) embed.setDescription(truncate(descParts.join('\n\n'), LIMITS.description));

  // Footer is set before packing fields so its length counts toward the 6000 cap.
  // Provenance lives here so it's stated exactly once, on every view.
  const footerText = metaFooter(meta, ['Values confirmed on Wowhead Classic']);
  if (footerText) embed.setFooter({ text: footerText });

  let fields;
  if (slotKey) {
    // Detailed single-slot view (optionally class-narrowed): one field per enchant
    // with full copy (effect, classes, authored notes). The match set is small
    // enough that per-enchant fields comfortably fit.
    fields = matches.map((ench) => {
      // The enchant name leads the value line as a masked link (field NAMES can't
      // render links); the field name is just the slot for scannability.
      const url = enchantWowheadUrl(ench);
      const nameMarkup = url ? `**[${ench.name}](${url})**` : `**${ench.name}**`;
      const lines = [`${nameMarkup} \u2014 ${ench.effect}`];
      // Under a class filter every row already applies to that class, so the
      // Classes: line is redundant noise — drop it.
      if (!classKey) lines.push(`Classes: ${ench.classes.map(capitalize).join(', ')}`);
      if (ench.notes) lines.push(ench.notes);
      // Every listed enchant is no-level-req (stated once in the note), so decorate
      // the field name only for the exception — a row that DOES gate on level.
      const levelTag = ench.noLevelReq ? '' : ` \u2014 requires level ${ench.reqLevel}`;
      return field(`${capitalize(ench.slot)}${levelTag}`, lines.join('\n'));
    });
  } else {
    // Overview (all enchants, or class-only): collapse to ONE field per slot with
    // compact lines, so the whole 39-enchant list fits without hitting the 25-field
    // or 6000-char caps (one-field-per-enchant used to drop ~half behind an overflow
    // note). A slot's lines spill into `(cont.)` fields past the 1024 value cap.
    const bySlot = new Map();
    for (const ench of matches) {
      const key = ench.slot.toLowerCase();
      if (!bySlot.has(key)) bySlot.set(key, []);
      bySlot.get(key).push(ench);
    }
    const orderedSlots = [...bySlot.keys()].sort(
      (a, b) => slotRank(a) - slotRank(b) || a.localeCompare(b)
    );
    fields = [];
    for (const key of orderedSlots) {
      const lines = bySlot.get(key).map((ench) => {
        const url = enchantWowheadUrl(ench);
        const name = shortName(ench.name);
        const nameMarkup = url ? `**[${name}](${url})**` : `**${name}**`;
        // The no-level-req norm is stated once in the note; flag only the exception
        // inline so the grouped line stays scannable.
        const levelTag = ench.noLevelReq ? '' : ` _(requires level ${ench.reqLevel})_`;
        return `${nameMarkup} \u2014 ${ench.effect}${levelTag}`;
      });
      fields.push(...fieldsFromLines(slotLabel(key), lines));
    }
  }

  // Safety net: pack under BOTH the 25-field and 6000-char caps. Grouping keeps
  // the overview well within budget, but a future content expansion could still
  // overrun (error 50035), so this guard stays.
  addFieldsWithinLimits(embed, fields, (dropped) =>
    field('\u2026', `${dropped} more not shown \u2014 narrow with a slot filter (e.g. \`/enchant slot:head\`).`)
  );

  return { embeds: [embed] };
}
