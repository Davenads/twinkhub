import { EmbedBuilder } from 'discord.js';
import { capitalize } from '../lib/text.js';
import { getGearItem, getEnchant } from '../content/store.js';
import { wowheadItemUrl, enchantWowheadUrl } from './gearFormat.js';
import { EMBED_COLOR, LIMITS, truncate, field, metaFooter, degradeEmbed } from '../lib/embed.js';

/**
 * Render a single gear item's detail (stats, source, faction, req level, class,
 * Wowhead link) from content data. Looked up by item id (the value the `/item`
 * autocomplete supplies). Degrades to a clear message when the id isn't found.
 *
 * @param {{ store: object, bracket: string, id: string }} args
 * @returns {{ embeds: EmbedBuilder[] }}
 */
export function renderItem({ store, bracket, id }) {
  const item = getGearItem(store, bracket, id);
  const meta = store?.brackets?.[bracket]?.meta;

  if (!item) {
    return {
      embeds: [degradeEmbed('Item', `No item found for **${id}** in bracket **${bracket}**.`)]
    };
  }

  // The item name IS the Wowhead link (clickable title) rather than a raw URL
  // dumped in a field.
  const embed = new EmbedBuilder()
    .setColor(EMBED_COLOR)
    .setTitle(truncate(item.name, LIMITS.title));
  if (item.wowheadId != null) embed.setURL(wowheadItemUrl(item.wowheadId));
  if (item.notes) embed.setDescription(truncate(item.notes, LIMITS.description));

  const fields = [
    field('Slot', capitalize(item.slot), true),
    field('Faction', capitalize(item.faction), true),
    field('Priority', capitalize(item.priority), true)
  ];

  if (item.stats && Object.keys(item.stats).length) {
    fields.push(
      field(
        'Stats',
        Object.entries(item.stats)
          .map(([k, v]) => `+${v} ${capitalize(k)}`)
          .join(', ')
      )
    );
  }
  if (item.source) {
    fields.push(field('Source', `${capitalize(item.source.type)} \u2014 ${item.source.detail}`));
  }
  if (item.reqLevel != null) {
    fields.push(field('Required level', String(item.reqLevel), true));
  }
  if (item.owner && item.owner !== 'shared') {
    fields.push(field('Class', capitalize(item.owner), true));
  }
  if (item.enchant) {
    const ench = getEnchant(store, bracket, item.enchant);
    if (ench) {
      const url = enchantWowheadUrl(ench);
      const name = url ? `**[${ench.name}](${url})**` : `**${ench.name}**`;
      let value = `${name} \u2014 ${ench.effect}`;
      if (ench.noLevelReq) value += '\nNo level requirement.';
      fields.push(field('Recommended enchant', value));
    } else {
      fields.push(field('Recommended enchant', item.enchant));
    }
  }
  if (item.alternatives?.length) {
    const lines = item.alternatives.map((altId) => {
      const alt = getGearItem(store, bracket, altId);
      if (!alt) return altId;
      const name =
        alt.wowheadId != null
          ? `**[${alt.name}](${wowheadItemUrl(alt.wowheadId)})**`
          : `**${alt.name}**`;
      return `${name} (${capitalize(alt.slot)})`;
    });
    fields.push(field('Alternatives', lines.join('\n')));
  }

  embed.addFields(fields);

  const footerText = metaFooter(meta);
  if (footerText) embed.setFooter({ text: footerText });

  return { embeds: [embed] };
}
