import { EmbedBuilder } from 'discord.js';
import { capitalize } from '../lib/text.js';
import { bracketConsumables, consumablesFor } from '../content/store.js';
import { EMBED_COLOR, LIMITS, truncate, field, metaTitle, metaFooter, degradeEmbed } from '../lib/embed.js';

// Discord caps embeds at 25 fields; one consumable per field.
const MAX_FIELDS = 25;

// Display order + labels for each consumable type.
const TYPE_ORDER = ['potion', 'poison', 'elixir', 'scroll', 'food', 'weapon-buff', 'explosive', 'worldbuff'];
const TYPE_LABEL = {
  potion: 'Potion',
  poison: 'Poison',
  elixir: 'Elixir',
  scroll: 'Scroll',
  food: 'Food',
  'weapon-buff': 'Weapon buff',
  explosive: 'Explosive',
  worldbuff: 'World buff'
};

function consumableLine(c) {
  const bits = [`_${TYPE_LABEL[c.type] ?? capitalize(c.type)}_`];
  if (c.faction && c.faction !== 'both') bits.push(capitalize(c.faction));
  if (Array.isArray(c.classes)) bits.push(c.classes.map(capitalize).join(', '));
  if (c.reqLevel != null) bits.push(`Req ${c.reqLevel}`);
  if (c.source) bits.push(c.source.detail);
  const lines = [c.effect, bits.join(' \u00b7 ')];
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

  // Group by type in a stable order so the list reads predictably.
  const ordered = [...matches].sort((a, b) => {
    const ai = TYPE_ORDER.indexOf(a.type);
    const bi = TYPE_ORDER.indexOf(b.type);
    return (ai === -1 ? TYPE_ORDER.length : ai) - (bi === -1 ? TYPE_ORDER.length : bi);
  });

  for (const c of ordered.slice(0, MAX_FIELDS)) {
    embed.addFields(field(c.name, consumableLine(c)));
  }
  if (ordered.length > MAX_FIELDS) {
    embed.addFields(
      field('\u2026', `${ordered.length - MAX_FIELDS} more not shown \u2014 narrow with a type or class filter.`)
    );
  }

  const footerText = metaFooter(meta);
  if (footerText) embed.setFooter({ text: footerText });

  return { embeds: [embed] };
}
