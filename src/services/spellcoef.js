import { EmbedBuilder } from 'discord.js';
import { capitalize } from '../lib/text.js';
import { bracketSpellcoef, spellcoefForClass, listClassNames } from '../content/store.js';
import { EMBED_COLOR, LIMITS, truncate, fieldsFromLines, metaTitle, metaFooter, degradeEmbed } from '../lib/embed.js';

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
 * A one-line source credit for the coefficient data. Masked links and user
 * mentions both render in an embed **description** (never a footer), so the
 * credit lives there. The `<@id>` mention is display-only — the command replies
 * with `allowedMentions: { parse: [] }`, so it never pings.
 */
function creditLine(credit) {
  if (!credit) return null;
  const label = credit.source ?? credit.url ?? 'source';
  const linked = credit.url ? `[${label}](${credit.url})` : label;
  const who = credit.discordId
    ? `${credit.author ? `${credit.author} ` : ''}(<@${credit.discordId}>)`.trim()
    : (credit.author ?? null);
  return who ? `Source: **${linked}** \u2014 credit to ${who}` : `Source: **${linked}**`;
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
  const degrade = (msg) => ({ embeds: [degradeEmbed('Spell Coefficients', msg)] });

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

  const title = metaTitle(`Spell Coefficients \u2014 ${capitalize(key)}`, meta);
  const embed = new EmbedBuilder().setColor(EMBED_COLOR).setTitle(title);
  const descParts = [];
  if (data.penalty?.note) descParts.push(data.penalty.note);
  const credit = creditLine(data.credit);
  if (credit) descParts.push(credit);
  if (descParts.length) embed.setDescription(truncate(descParts.join('\n\n'), LIMITS.description));

  for (const type of TYPE_ORDER) {
    const group = spells.filter((s) => s.type === type);
    if (!group.length) continue;
    // A single effect-type list can overrun the 1024-char field cap (mage's
    // direct-damage ranks do); split across fields instead of dropping ranks.
    for (const f of fieldsFromLines(TYPE_LABEL[type], group.map(spellLine))) embed.addFields(f);
  }

  const unverified = spells.filter((s) => s.confirmed === false).length;
  const extra = unverified ? [`${unverified} value${unverified === 1 ? '' : 's'} unverified`] : [];
  const footerText = metaFooter(meta, extra);
  if (footerText) embed.setFooter({ text: footerText });

  return { embeds: [embed] };
}
