import { EmbedBuilder } from 'discord.js';
import { capitalize } from '../lib/text.js';
import { bracketSpellcoef, spellcoefForClass, listClassNames } from '../content/store.js';

const EMBED_COLOR = 0xc8aa6e;

// Display order + labels for each effect type. dot/hot are per-tick and proc is
// per-hit, so the coefficient unit differs from the per-cast direct spells.
const TYPE_ORDER = ['direct-damage', 'dot', 'direct-heal', 'hot', 'shield', 'proc'];
const TYPE_LABEL = {
  'direct-damage': 'Direct damage',
  dot: 'Damage over time',
  'direct-heal': 'Direct heal',
  hot: 'Heal over time',
  shield: 'Absorb shield',
  proc: 'Proc'
};
const TYPE_UNIT = {
  'direct-damage': 'per cast',
  dot: 'per tick',
  'direct-heal': 'per cast',
  hot: 'per tick',
  shield: 'per cast',
  proc: 'per hit'
};

function spellLine(s) {
  const unit = TYPE_UNIT[s.type] ?? 'per cast';
  const parts = [`**${s.spell}** (Rank ${s.rank}) \u2014 ${s.coefficient} ${unit}`];
  if (s.confirmed === false) parts.push('\u2014 _unverified_');
  const line = parts.join(' ');
  return s.notes ? `${line}\n_${s.notes}_` : line;
}

/**
 * Render a caster/hybrid class's level-19-effective spell power coefficients from
 * `spellcoefficients.json`, grouped by effect type, with the sub-level-20 penalty
 * note leading. Values flagged `confirmed: false` are marked _unverified_ so they
 * are never presented as authoritative. Melee-only classes (and any roster class
 * with no authored entry) degrade to a clean "no spell scaling at 19" reply.
 *
 * @param {{ store: object, bracket: string, className: string }} args
 * @returns {{ embeds: EmbedBuilder[] }}
 */
export function renderSpellcoef({ store, bracket, className }) {
  const data = bracketSpellcoef(store, bracket);
  const meta = store?.brackets?.[bracket]?.meta;
  const degrade = (msg) => ({
    embeds: [new EmbedBuilder().setColor(EMBED_COLOR).setTitle('Spell Coefficients').setDescription(msg)]
  });

  if (!data) return degrade(`No spell-coefficient data is loaded for bracket **${bracket}**.`);

  const key = String(className ?? '').toLowerCase();
  const spells = spellcoefForClass(store, bracket, key);
  if (!spells) {
    const roster = listClassNames(store, bracket);
    if (roster.includes(key)) {
      return degrade(
        `**${capitalize(key)}** has no spell-power scaling at level 19 \u2014 its abilities scale with attack power, not spell power.`
      );
    }
    return degrade(`No spell-coefficient data is authored for **${capitalize(key || String(className))}** in bracket **${bracket}**.`);
  }

  const title = `Spell Coefficients \u2014 ${capitalize(key)}${meta ? ` (${meta.battleground} ${meta.levelCap})` : ''}`;
  const embed = new EmbedBuilder().setColor(EMBED_COLOR).setTitle(title);
  if (data.penalty?.note) embed.setDescription(data.penalty.note);

  for (const type of TYPE_ORDER) {
    const group = spells.filter((s) => s.type === type);
    if (!group.length) continue;
    embed.addFields({ name: TYPE_LABEL[type], value: group.map(spellLine).join('\n') });
  }

  const unverified = spells.filter((s) => s.confirmed === false).length;
  const footerBits = [];
  if (meta?.gameVersion?.clientPatch) footerBits.push(`WoW Classic Era ${meta.gameVersion.clientPatch}`);
  if (unverified) footerBits.push(`${unverified} value${unverified === 1 ? '' : 's'} unverified`);
  if (footerBits.length) embed.setFooter({ text: footerBits.join(' \u00b7 ') });

  return { embeds: [embed] };
}
