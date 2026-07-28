import { EmbedBuilder } from 'discord.js';
import { capitalize } from '../lib/text.js';
import { bracketEnchants } from '../content/store.js';

const EMBED_COLOR = 0xc8aa6e;
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
    return {
      embeds: [
        new EmbedBuilder()
          .setColor(EMBED_COLOR)
          .setTitle('Enchants')
          .setDescription(`No enchant data is loaded for bracket **${bracket}**.`)
      ]
    };
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

  const title = meta ? `Enchants \u2014 ${meta.battleground} ${meta.levelCap}` : 'Enchants';
  const embed = new EmbedBuilder().setColor(EMBED_COLOR).setTitle(title);

  if (!matches.length) {
    embed.setDescription(
      scope.length
        ? `No enchants match ${scope.join(' and ')} in bracket **${bracket}**.`
        : `No enchants are authored for bracket **${bracket}**.`
    );
    return { embeds: [embed] };
  }

  const descParts = [];
  if (scope.length) descParts.push(`Filtered to ${scope.join(' and ')}.`);
  if (data.note) descParts.push(data.note);
  if (descParts.length) embed.setDescription(descParts.join('\n\n'));

  for (const ench of matches.slice(0, MAX_FIELDS)) {
    const name = ench.noLevelReq ? `${ench.name} \u2014 no level req` : ench.name;
    const lines = [ench.effect];
    if (ench.noLevelReq) lines.push('Ignores the item\u2019s level requirement.');
    lines.push(`Slot: ${ench.slot} \u00b7 Classes: ${ench.classes.map(capitalize).join(', ')}`);
    if (ench.notes) lines.push(ench.notes);
    embed.addFields({ name, value: lines.join('\n') });
  }

  if (matches.length > MAX_FIELDS) {
    embed.addFields({
      name: '\u2026',
      value: `${matches.length - MAX_FIELDS} more not shown \u2014 narrow with a slot or class filter.`
    });
  }

  if (meta?.gameVersion?.clientPatch) {
    embed.setFooter({ text: `WoW Classic Era ${meta.gameVersion.clientPatch}` });
  }

  return { embeds: [embed] };
}
