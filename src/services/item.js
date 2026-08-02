import { EmbedBuilder } from 'discord.js';
import { capitalize } from '../lib/text.js';
import { getGearItem, getEnchant } from '../content/store.js';
import { wowheadItemUrl } from './gearFormat.js';

const EMBED_COLOR = 0xc8aa6e;

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
      embeds: [
        new EmbedBuilder()
          .setColor(EMBED_COLOR)
          .setTitle('Item')
          .setDescription(`No item found for **${id}** in bracket **${bracket}**.`)
      ]
    };
  }

  const embed = new EmbedBuilder().setColor(EMBED_COLOR).setTitle(item.name);
  if (item.notes) embed.setDescription(item.notes);

  const fields = [
    { name: 'Slot', value: capitalize(item.slot), inline: true },
    { name: 'Faction', value: capitalize(item.faction), inline: true },
    { name: 'Priority', value: capitalize(item.priority), inline: true }
  ];

  if (item.stats && Object.keys(item.stats).length) {
    fields.push({
      name: 'Stats',
      value: Object.entries(item.stats)
        .map(([k, v]) => `+${v} ${capitalize(k)}`)
        .join(', ')
    });
  }
  if (item.source) {
    fields.push({ name: 'Source', value: `${capitalize(item.source.type)} \u2014 ${item.source.detail}` });
  }
  if (item.reqLevel != null) {
    fields.push({ name: 'Required level', value: String(item.reqLevel), inline: true });
  }
  if (item.owner && item.owner !== 'shared') {
    fields.push({ name: 'Class', value: capitalize(item.owner), inline: true });
  }
  if (item.enchant) {
    const ench = getEnchant(store, bracket, item.enchant);
    if (ench) {
      let value = `**${ench.name}** \u2014 ${ench.effect}`;
      if (ench.noLevelReq) value += '\nNo level requirement.';
      fields.push({ name: 'Recommended enchant', value });
    } else {
      fields.push({ name: 'Recommended enchant', value: item.enchant });
    }
  }
  if (item.alternatives?.length) {
    const lines = item.alternatives.map((altId) => {
      const alt = getGearItem(store, bracket, altId);
      return alt ? `**${alt.name}** (${capitalize(alt.slot)})` : altId;
    });
    fields.push({ name: 'Alternatives', value: lines.join('\n') });
  }
  if (item.wowheadId != null) {
    fields.push({ name: 'Wowhead', value: wowheadItemUrl(item.wowheadId) });
  }

  embed.addFields(fields);

  if (meta?.gameVersion?.clientPatch) {
    embed.setFooter({ text: `WoW Classic Era ${meta.gameVersion.clientPatch}` });
  }

  return { embeds: [embed] };
}
