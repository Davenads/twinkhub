import { EmbedBuilder } from 'discord.js';
import { capitalize } from '../lib/text.js';
import { bracketConsumables, consumablesFor, consumableIcon } from '../content/store.js';
import {
  EMBED_COLOR,
  LIMITS,
  truncate,
  field,
  metaTitle,
  metaFooter,
  degradeEmbed,
  addFieldsWithinLimits
} from '../lib/embed.js';

// Display order + labels for each consumable type.
const TYPE_ORDER = ['potion', 'poison', 'elixir', 'scroll', 'food', 'bandage', 'weapon-buff', 'explosive', 'worldbuff', 'utility'];
const TYPE_LABEL = {
  potion: 'Potion',
  poison: 'Poison',
  elixir: 'Elixir',
  scroll: 'Scroll',
  food: 'Food',
  bandage: 'Bandage',
  'weapon-buff': 'Weapon buff',
  explosive: 'Explosive',
  worldbuff: 'World buff',
  utility: 'Utility'
};

function consumableLine(c, hideClasses = false, icon = '') {
  const bits = [`_${TYPE_LABEL[c.type] ?? capitalize(c.type)}_`];
  if (c.faction && c.faction !== 'both') bits.push(capitalize(c.faction));
  // Under a class filter the per-row class list is redundant (every row applies
  // to that class), so it's hidden to fit more entries under the 6000-char cap.
  if (!hideClasses && Array.isArray(c.classes)) bits.push(c.classes.map(capitalize).join(', '));
  if (c.reqLevel != null) bits.push(`Req ${c.reqLevel}`);
  if (c.source) bits.push(c.source.detail);
  // Custom emoji render in field VALUES, not names, so the icon leads the body.
  const lines = [icon ? `${icon} ${c.effect}` : c.effect, bits.join(' \u00b7 ')];
  if (c.notes) lines.push(c.notes);
  return lines.join('\n');
}

/**
 * Render a bracket's recommended consumables, optionally filtered by `type` and/or
 * `className`. A class filter keeps universal consumables plus those naming the
 * class. All copy comes from `consumables.json`; shared by `/consumable` and,
 * later, the consumables panel.
 *
 * @param {{ store: object, bracket: string, type?: string|null, className?: string|null }} args
 * @returns {{ embeds: EmbedBuilder[] }}
 */
export function renderConsumable({ store, bracket, type = null, className = null }) {
  const data = bracketConsumables(store, bracket);
  const meta = store?.brackets?.[bracket]?.meta;
  const title = metaTitle('Consumables', meta);

  if (!data) {
    return { embeds: [degradeEmbed(title, `No consumable data is loaded for bracket **${bracket}**.`)] };
  }

  const typeKey = type ? String(type).toLowerCase() : null;
  const classKey = className ? String(className).toLowerCase() : null;
  const matches = consumablesFor(store, bracket, { type: typeKey, className: classKey });

  const scope = [
    typeKey ? `type **${TYPE_LABEL[typeKey] ?? typeKey}**` : null,
    classKey ? `class **${capitalize(classKey)}**` : null
  ].filter(Boolean);

  if (!matches.length) {
    return {
      embeds: [
        degradeEmbed(
          title,
          scope.length
            ? `No consumables match ${scope.join(' and ')} in bracket **${bracket}**.`
            : `No consumables are authored for bracket **${bracket}**.`
        )
      ]
    };
  }

  const embed = new EmbedBuilder().setColor(EMBED_COLOR).setTitle(title);

  const descParts = [];
  if (scope.length) descParts.push(`Filtered to ${scope.join(' and ')}.`);
  if (data.note) descParts.push(data.note);
  if (descParts.length) embed.setDescription(truncate(descParts.join('\n\n'), LIMITS.description));

  // A per-type note (e.g. the weapon-buff/shaman-imbue conflict) is shown once —
  // only when the list is filtered to that type — as a footnote field at the
  // bottom (just above the footer), instead of on every row or up in the header.
  const typeNote = typeKey ? data.typeNotes?.[typeKey] ?? null : null;

  // Footer is set before packing fields so its length counts toward the 6000 cap.
  const footerText = metaFooter(meta);
  if (footerText) embed.setFooter({ text: footerText });

  // Group by type in a stable order so the list reads predictably.
  const ordered = [...matches].sort((a, b) => {
    const ai = TYPE_ORDER.indexOf(a.type);
    const bi = TYPE_ORDER.indexOf(b.type);
    return (ai === -1 ? TYPE_ORDER.length : ai) - (bi === -1 ? TYPE_ORDER.length : bi);
  });

  const fields = ordered.map((c) =>
    field(c.name, consumableLine(c, Boolean(classKey), consumableIcon(store, c.id)))
  );
  // The type note trails the item list so it reads as a bottom footnote; kept in
  // the packed set so it counts toward the 6000-char cap.
  if (typeNote) fields.push(field('Note', typeNote));
  // Pack under BOTH the 25-field and 6000-char caps so a class-only list can't
  // overrun the total-embed size (error 50035).
  addFieldsWithinLimits(embed, fields, (dropped) =>
    field('\u2026', `${dropped} more not shown \u2014 narrow with a type or class filter.`)
  );

  return { embeds: [embed] };
}
