import { EmbedBuilder } from 'discord.js';
import { capitalize } from '../lib/text.js';
import { bracketScaling, statweightsForClass } from '../content/store.js';

const EMBED_COLOR = 0xc8aa6e;

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
  const degrade = (msg) => ({
    embeds: [new EmbedBuilder().setColor(EMBED_COLOR).setTitle('Stat Weights').setDescription(msg)]
  });

  if (!scaling) return degrade(`No stat-scaling data is loaded for bracket **${bracket}**.`);

  const forClass = statweightsForClass(store, bracket, className);
  if (!forClass) {
    return degrade(
      `No stat-weight data is authored for **${capitalize(String(className))}** in bracket **${bracket}** yet.`
    );
  }

  const { entry } = forClass;
  const title = `Stat Weights \u2014 ${capitalize(forClass.className)}${
    meta ? ` (${meta.battleground} ${meta.levelCap})` : ''
  }`;
  const priorityLine = entry.priority.map((s) => scaling.stats[s]?.label ?? capitalize(s)).join(' > ');

  const embed = new EmbedBuilder()
    .setColor(EMBED_COLOR)
    .setTitle(title)
    .setDescription(`**Priority:** ${priorityLine}`);

  for (const statKey of entry.priority) {
    const stat = scaling.stats[statKey];
    if (!stat) continue;
    embed.addFields({
      name: stat.label,
      value: [stat.summary, ...stat.conversions.map((c) => `\u2022 ${c}`)].join('\n')
    });
  }

  embed.addFields({ name: 'Class notes', value: entry.notes.map((n) => `\u2022 ${n}`).join('\n') });

  if (scaling.derived?.length) {
    embed.addFields({
      name: 'Derived formulas',
      value: scaling.derived
        .map((d) => `**${d.name}:** ${d.formula}${d.notes ? ` (${d.notes})` : ''}`)
        .join('\n')
    });
  }
  if (scaling.hitCaps?.length) {
    embed.addFields({
      name: 'PvP hit caps',
      value: scaling.hitCaps.map((h) => `${capitalize(h.type)}: ${h.value}`).join('\n')
    });
  }

  if (meta?.gameVersion?.clientPatch) {
    embed.setFooter({ text: `WoW Classic Era ${meta.gameVersion.clientPatch}` });
  }

  return { embeds: [embed] };
}
