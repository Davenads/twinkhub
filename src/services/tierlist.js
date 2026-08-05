import { EmbedBuilder } from 'discord.js';
import { capitalize } from '../lib/text.js';
import { classIcon } from '../content/store.js';
import { EMBED_COLOR, LIMITS, truncate, field, metaTitle, metaFooter, degradeEmbed } from '../lib/embed.js';

// Conventional high-to-low order; any tier not listed is appended alphabetically.
const TIER_ORDER = ['S', 'A', 'B', 'C', 'D', 'F'];

function tierRank(tier) {
  const i = TIER_ORDER.indexOf(tier);
  return i === -1 ? TIER_ORDER.length : i;
}

/**
 * Render the bracket's class tier list from the roster (`classes/index.json`).
 * Groups classes by tier, high to low. Shared by `/tierlist` and, later, the
 * class-builds panel.
 *
 * @param {{ store: object, bracket: string }} args
 * @returns {{ embeds: EmbedBuilder[] }}
 */
export function renderTierlist({ store, bracket }) {
  const bracketData = store?.brackets?.[bracket];
  const roster = bracketData?.classes?.index?.classes;
  if (!roster?.length) {
    return { embeds: [degradeEmbed('Class Tier List', `No class data is loaded for bracket **${bracket}**.`)] };
  }

  const meta = bracketData.meta;
  const embed = new EmbedBuilder().setColor(EMBED_COLOR).setTitle(metaTitle('Class Tier List', meta));

  if (bracketData.classes.index.tierNote) {
    embed.setDescription(truncate(bracketData.classes.index.tierNote, LIMITS.description));
  }

  const tiers = [...new Set(roster.map((e) => e.tier))].sort(
    (a, b) => tierRank(a) - tierRank(b) || a.localeCompare(b)
  );

  for (const tier of tiers) {
    const members = roster.filter((e) => e.tier === tier);
    embed.addFields(
      field(
        `Tier ${tier}`,
        members
          .map((e) => {
            // Class emoji prefix; degrades to text-only when the id is unfilled.
            const icon = classIcon(store, e.class);
            return `${icon ? `${icon} ` : ''}**${capitalize(e.class)}** \u2014 ${e.summary}`;
          })
          .join('\n')
      )
    );
  }

  const footerText = metaFooter(meta);
  if (footerText) embed.setFooter({ text: footerText });

  return { embeds: [embed] };
}
