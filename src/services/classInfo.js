import { EmbedBuilder } from 'discord.js';
import { capitalize, formatStatPriority } from '../lib/text.js';
import { getClass } from '../content/store.js';
import { EMBED_COLOR, LIMITS, truncate, field, metaTitle, metaFooter, degradeEmbed } from '../lib/embed.js';

/**
 * Render a single class overview (tier, roles, stat priority, faction notes)
 * from content data. Uses the full detail file when present and degrades
 * to the roster entry otherwise. Shared by `/class` and the class-builds panel.
 *
 * @param {{ store: object, bracket: string, className: string }} args
 * @returns {{ embeds: EmbedBuilder[] }}
 */
export function renderClass({ store, bracket, className }) {
  const data = getClass(store, bracket, className);
  const bracketData = store?.brackets?.[bracket];
  if (!data) {
    return { embeds: [degradeEmbed('Class', `No data for **${className}** in bracket **${bracket}**.`)] };
  }

  const meta = bracketData.meta;
  const embed = new EmbedBuilder()
    .setColor(EMBED_COLOR)
    .setTitle(metaTitle(`${capitalize(data.class)} \u2014 Tier ${data.tier}`, meta))
    .setDescription(truncate(data.summary, LIMITS.description))
    .addFields(field('Roles', data.roles.join(', ')));

  if (Array.isArray(data.statPriority) && data.statPriority.length) {
    embed.addFields(field('Stat priority', formatStatPriority(data.statPriority)));
  }

  if (data.factionNotes) {
    embed.addFields(field('Faction notes', data.factionNotes));
  }

  const footerText = metaFooter(meta);
  if (footerText) embed.setFooter({ text: footerText });

  return { embeds: [embed] };
}
