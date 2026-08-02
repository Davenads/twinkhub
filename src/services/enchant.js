import { EmbedBuilder } from 'discord.js';
import { capitalize } from '../lib/text.js';
import { bracketEnchants } from '../content/store.js';
import { enchantWowheadUrl } from './gearFormat.js';
import { EMBED_COLOR, LIMITS, truncate, field, metaTitle, metaFooter, degradeEmbed } from '../lib/embed.js';

// Discord caps embeds at 25 fields; one enchant per field.
const MAX_FIELDS = 25;

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

  for (const ench of matches.slice(0, MAX_FIELDS)) {
    // The enchant name leads the value line as a masked link (field NAMES can't
    // render links); the field name is just the slot for scannability.
    const url = enchantWowheadUrl(ench);
    const nameMarkup = url ? `**[${ench.name}](${url})**` : `**${ench.name}**`;
    const lines = [`${nameMarkup} \u2014 ${ench.effect}`];
    if (ench.noLevelReq) lines.push('_Ignores the item\u2019s level requirement._');
    lines.push(`Classes: ${ench.classes.map(capitalize).join(', ')}`);
    if (ench.notes) lines.push(ench.notes);
    embed.addFields(field(`${capitalize(ench.slot)}${ench.noLevelReq ? ' \u2014 no level req' : ''}`, lines.join('\n')));
  }

  if (matches.length > MAX_FIELDS) {
    embed.addFields(
      field('\u2026', `${matches.length - MAX_FIELDS} more not shown \u2014 narrow with a slot or class filter.`)
    );
  }

  const footerText = metaFooter(meta);
  if (footerText) embed.setFooter({ text: footerText });

  return { embeds: [embed] };
}
