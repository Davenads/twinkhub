import { EmbedBuilder } from 'discord.js';
import { capitalize } from '../lib/text.js';
import {
  bracketTalents,
  talentsForClass,
  listClassNames,
  classIcon,
  talentIcon
} from '../content/store.js';
import {
  EMBED_COLOR,
  LIMITS,
  truncate,
  field,
  addFieldsWithinLimits,
  metaTitle,
  metaFooter,
  degradeEmbed
} from '../lib/embed.js';

/**
 * One node's inline chip: `<:Furor:id> 5/5 Furor`. The emoji is decorative and
 * degrades to text-only when its registry id is unfilled (`talentIcon` returns
 * '') — so the chip is always legible. Custom emoji only render in message
 * content, an embed description, or a field **value**, which is why the whole
 * node row lives in the field value, never the field name.
 */
function nodeChip(store, n) {
  const icon = talentIcon(store, n.emoji);
  const label = `${n.rank}/${n.max} ${n.talent}`;
  return icon ? `${icon} ${label}` : label;
}

/** A one-line source credit, rendered in the description (masked links/mentions
 * only render there, never in a footer). Mirrors the spellcoef credit line. */
function creditLine(credit) {
  if (!credit) return null;
  const label = credit.source ?? credit.url ?? 'source';
  const linked = credit.url ? `[${label}](${credit.url})` : label;
  const who = credit.discordId
    ? `${credit.author ? `${credit.author} ` : ''}(<@${credit.discordId}>)`.trim()
    : (credit.author ?? null);
  return who ? `Source: **${linked}** \u2014 credit to ${who}` : `Source: **${linked}**`;
}

// A thin rule appended between builds in the all-builds view so consecutive
// builds read as distinct blocks instead of one running wall of text.
const BUILD_DIVIDER = '\u2500'.repeat(18);

/** The value block for a build in the all-builds view: node chips (which already
 * carry each node's rank/max and talent name), summary, an optional note, then
 * the masked Wowhead link. The point allocation is intentionally NOT repeated as
 * a separate line — the chips are its single source. */
function buildValue(store, b) {
  const parts = [];
  const chips = b.nodes.map((n) => nodeChip(store, n)).join(' \u00b7 ');
  if (chips) parts.push(chips);
  if (b.summary) parts.push(b.summary);
  if (b.note) parts.push(`\u26a0\ufe0f ${b.note}`);
  if (b.url) parts.push(`[Open in Wowhead](${b.url})`);
  return parts.join('\n');
}

/** Field name for a build: text-only (no custom emoji renders in a field name).
 * Tags the default build and its role when present. */
function buildName(b) {
  const tags = [];
  if (b.role) tags.push(b.role);
  if (b.default) tags.push('default');
  return tags.length ? `${b.name} \u2014 ${tags.join(', ')}` : b.name;
}

/**
 * Render a class's level-19 PvP talent builds from `talents.json`. Default view
 * lists every authored build (one field each); passing `build` narrows to that
 * one build with a per-node breakdown. Degrade-safe: an unauthored roster class,
 * an unknown class, or a bracket with no talent data all return a clean degrade
 * embed rather than throwing.
 *
 * @param {{ store: object, bracket: string, className: string, build?: string|null }} args
 * @returns {{ embeds: EmbedBuilder[] }}
 */
export function renderTalents({ store, bracket, className, build = null }) {
  const data = bracketTalents(store, bracket);
  const meta = store?.brackets?.[bracket]?.meta;
  const degrade = (msg) => ({ embeds: [degradeEmbed('Talent Builds', msg)] });

  if (!data) return degrade(`No talent data is loaded for bracket **${bracket}**.`);

  const key = String(className ?? '').toLowerCase();
  const builds = talentsForClass(store, bracket, key);
  if (!builds) {
    const roster = listClassNames(store, bracket);
    if (roster.includes(key)) {
      return degrade(`No talent builds are authored for **${capitalize(key)}** yet.`);
    }
    return degrade(`No talent data is authored for **${capitalize(key || String(className))}** in bracket **${bracket}**.`);
  }

  const icon = classIcon(store, key);
  const title = metaTitle(`Talent Builds \u2014 ${capitalize(key)}`, meta);
  const embed = new EmbedBuilder().setColor(EMBED_COLOR).setTitle(title);

  const descParts = [];
  if (data.note) descParts.push(data.note);
  // A credit carrying a link or mention must render in the description (footers
  // can't show masked links or mentions); a plain source credit goes in the
  // footer instead, keeping the pre-build description short.
  const credit = data.credit;
  const creditInDesc = Boolean(credit && (credit.url || credit.author || credit.discordId));
  if (creditInDesc) descParts.push(creditLine(credit));

  // Narrow to a single build when requested (the panel deep-dive / switcher).
  const one = build ? builds.find((b) => b.id === String(build)) : null;
  if (build && !one) {
    return degrade(`No talent build **${build}** is authored for **${capitalize(key)}**.`);
  }

  if (one) {
    const header = icon ? `${icon} **${one.name}**` : `**${one.name}**`;
    descParts.unshift(header);
    if (descParts.length) embed.setDescription(truncate(descParts.join('\n\n'), LIMITS.description));
    if (one.summary) embed.addFields(field('Summary', one.summary));
    // One node per line so the per-node ranks read cleanly for a deep-dive; the
    // chips already carry each rank/max, so there's no separate Points field.
    const nodeLines = one.nodes.map((n) => nodeChip(store, n)).join('\n');
    embed.addFields(field('Nodes', nodeLines));
    if (one.note) embed.addFields(field('Note', `\u26a0\ufe0f ${one.note}`));
    if (one.url) embed.addFields(field('Talent calculator', `[Open in Wowhead](${one.url})`));
  } else {
    // Lead the description with the class icon so it renders (icons don't show in
    // titles). Then one field per build.
    if (icon) descParts.unshift(`${icon} **${capitalize(key)}** \u2014 ${builds.length} build${builds.length === 1 ? '' : 's'}`);
    if (descParts.length) embed.setDescription(truncate(descParts.join('\n\n'), LIMITS.description));
    // Append a rule after every build but the last so builds read as distinct blocks.
    const last = builds.length - 1;
    const fields = builds.map((b, i) => {
      const val = i < last ? `${buildValue(store, b)}\n${BUILD_DIVIDER}` : buildValue(store, b);
      return field(buildName(b), val);
    });
    addFieldsWithinLimits(embed, fields, (dropped) => field('\u2026', `${dropped} more build${dropped === 1 ? '' : 's'} not shown`));
  }

  // Footer: bracket meta, plus a plain source credit when it wasn't shown above.
  const footerBits = [];
  const metaFoot = metaFooter(meta);
  if (metaFoot) footerBits.push(metaFoot);
  if (credit && !creditInDesc) footerBits.push(`Source: ${credit.source ?? credit.url ?? 'source'}`);
  if (footerBits.length) embed.setFooter({ text: footerBits.join(' \u00b7 ') });

  return { embeds: [embed] };
}
