import { EmbedBuilder } from 'discord.js';
import { capitalize } from '../lib/text.js';
import { getClass, classIcon } from '../content/store.js';
import { EMBED_COLOR, LIMITS, truncate, field, metaTitle, metaFooter, degradeEmbed } from '../lib/embed.js';

/** Title-case a slug like `ranged-dps` -> `Ranged Dps` / `flag-carrier` -> `Flag Carrier`. */
function formatSlug(slug) {
  return String(slug ?? '')
    .split('-')
    .map(capitalize)
    .join(' ');
}

/**
 * Render a class overview ("hub") embed: the neutral landing shown when a class
 * is picked from the panel, before any build is chosen. Pure render over the
 * class content (`getClass`): tier, role(s), summary, per-spec stat priority,
 * and faction notes, led by the class icon. The build dropdown and follow-up
 * buttons are attached by the component router, not here — this returns only the
 * embed so it composes like `renderBis`.
 *
 * @param {{ store: object, bracket: string, className: string }} args
 * @returns {{ embeds: EmbedBuilder[] }}
 */
export function renderClassHub({ store, bracket, className }) {
  const key = String(className ?? '').toLowerCase();
  const cls = getClass(store, bracket, key);
  const meta = store?.brackets?.[bracket]?.meta;

  if (!cls) {
    return { embeds: [degradeEmbed('Class Overview', `No class **${capitalize(key)}** is authored for bracket **${bracket}**.`)] };
  }

  const icon = classIcon(store, key);
  const title = metaTitle(`${capitalize(key)} \u2014 Overview`, meta);
  const embed = new EmbedBuilder().setColor(EMBED_COLOR).setTitle(title);

  // Header line (icon renders in the description, never a title/footer) + summary.
  const header = [];
  if (icon) header.push(icon);
  if (cls.tier) header.push(`**Tier ${cls.tier}**`);
  if (Array.isArray(cls.roles) && cls.roles.length) header.push(cls.roles.map(formatSlug).join(', '));
  const parts = [];
  if (header.length) parts.push(header.join(' \u00b7 '));
  if (cls.summary) parts.push(cls.summary);
  parts.push('Pick a build below for its best-in-slot gear; use the buttons for enchants, consumables, and more.');
  embed.setDescription(truncate(parts.join('\n\n'), LIMITS.description));

  // Per-spec stat priority (offense/caster builds care most).
  if (Array.isArray(cls.specs) && cls.specs.length) {
    const lines = cls.specs
      .map((s) => {
        const pri = Array.isArray(s.statPriority) ? s.statPriority.map(capitalize).join(' > ') : null;
        if (!pri) return s.name ?? null;
        return s.name ? `**${s.name}**: ${pri}` : pri;
      })
      .filter(Boolean);
    if (lines.length) embed.addFields(field('Stat priority', lines.join('\n')));
  }

  if (cls.factionNotes) embed.addFields(field('Faction notes', cls.factionNotes));

  const footerText = metaFooter(meta);
  if (footerText) embed.setFooter({ text: footerText });

  return { embeds: [embed] };
}
