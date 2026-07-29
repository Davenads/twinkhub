import { EmbedBuilder } from 'discord.js';
import { capitalize } from '../lib/text.js';
import { getClass } from '../content/store.js';

const EMBED_COLOR = 0xc8aa6e;

/**
 * Render a single class overview (tier, roles, specs, stat priority, faction
 * notes) from content data. Uses the full detail file when present and degrades
 * to the roster entry otherwise. Shared by `/class` and the class-builds panel.
 *
 * @param {{ store: object, bracket: string, className: string }} args
 * @returns {{ embeds: EmbedBuilder[] }}
 */
export function renderClass({ store, bracket, className }) {
  const data = getClass(store, bracket, className);
  const bracketData = store?.brackets?.[bracket];
  if (!data) {
    return {
      embeds: [
        new EmbedBuilder()
          .setColor(EMBED_COLOR)
          .setTitle('Class')
          .setDescription(`No data for **${className}** in bracket **${bracket}**.`)
      ]
    };
  }

  const meta = bracketData.meta;
  const embed = new EmbedBuilder()
    .setColor(EMBED_COLOR)
    .setTitle(`${capitalize(data.class)} \u2014 Tier ${data.tier} (${meta.battleground} ${meta.levelCap})`)
    .setDescription(data.summary)
    .addFields({ name: 'Roles', value: data.roles.join(', ') });

  if (Array.isArray(data.specs) && data.specs.length) {
    embed.addFields({
      name: 'Specs & stat priority',
      value: data.specs
        .map((s) => `**${s.name}** \u2014 ${s.statPriority.map(capitalize).join(' > ')}`)
        .join('\n')
    });
  }

  if (data.factionNotes) {
    embed.addFields({ name: 'Faction notes', value: data.factionNotes });
  }

  if (meta.gameVersion?.clientPatch) {
    embed.setFooter({ text: `WoW Classic Era ${meta.gameVersion.clientPatch}` });
  }

  return { embeds: [embed] };
}
