import { EmbedBuilder } from 'discord.js';
import { capitalize } from '../lib/text.js';
import { bracketScaling, statweightsForClass } from '../content/store.js';
import { EMBED_COLOR, LIMITS, truncate, field, metaTitle, metaFooter, degradeEmbed } from '../lib/embed.js';

/**
 * Render a class's stat weights from `scaling.json`: its priority order and
 * class-specific notes, the conversions for each priority stat, plus the shared
 * derived formulas and PvP hit caps — so players understand *why* a stat (and
 * therefore an item) wins. All copy is data; no game knowledge lives here.
 *
 * @param {{ store: object, bracket: string, className: string }} args
 * @returns {{ embeds: EmbedBuilder[] }}
 */
export function renderStatweights({ store, bracket, className }) {
  const scaling = bracketScaling(store, bracket);
  const meta = store?.brackets?.[bracket]?.meta;
  const degrade = (msg) => ({ embeds: [degradeEmbed('Stat Weights', msg)] });

  if (!scaling) return degrade(`No stat-scaling data is loaded for bracket **${bracket}**.`);

  const forClass = statweightsForClass(store, bracket, className);
  if (!forClass) {
    return degrade(
      `No stat-weight data is authored for **${capitalize(String(className))}** in bracket **${bracket}** yet.`
    );
  }

  const { entry } = forClass;
  const title = metaTitle(`Stat Weights \u2014 ${capitalize(forClass.className)}`, meta);
  const priorityLine = entry.priority.map((s) => scaling.stats[s]?.label ?? capitalize(s)).join(' > ');

  const embed = new EmbedBuilder()
    .setColor(EMBED_COLOR)
    .setTitle(title)
    .setDescription(truncate(`**Priority:** ${priorityLine}`, LIMITS.description));

  for (const statKey of entry.priority) {
    const stat = scaling.stats[statKey];
    if (!stat) continue;
    embed.addFields(field(stat.label, [stat.summary, ...stat.conversions.map((c) => `\u2022 ${c}`)].join('\n')));
  }

  embed.addFields(field('Class notes', entry.notes.map((n) => `\u2022 ${n}`).join('\n')));

  if (scaling.derived?.length) {
    embed.addFields(
      field(
        'Derived formulas',
        scaling.derived.map((d) => `**${d.name}:** ${d.formula}${d.notes ? ` (${d.notes})` : ''}`).join('\n')
      )
    );
  }
  if (scaling.hitCaps?.length) {
    embed.addFields(field('PvP hit caps', scaling.hitCaps.map((h) => `${capitalize(h.type)}: ${h.value}`).join('\n')));
  }

  const footerText = metaFooter(meta);
  if (footerText) embed.setFooter({ text: footerText });

  return { embeds: [embed] };
}
