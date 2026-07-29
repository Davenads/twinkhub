import { EmbedBuilder } from 'discord.js';
import { capitalize } from '../lib/text.js';

const EMBED_COLOR = 0xc8aa6e;
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
    return {
      embeds: [
        new EmbedBuilder()
          .setColor(EMBED_COLOR)
          .setTitle('Class Tier List')
          .setDescription(`No class data is loaded for bracket **${bracket}**.`)
      ]
    };
  }

  const meta = bracketData.meta;
  const embed = new EmbedBuilder()
    .setColor(EMBED_COLOR)
    .setTitle(`Class Tier List \u2014 ${meta.battleground} ${meta.levelCap}`);

  if (bracketData.classes.index.tierNote) {
    embed.setDescription(bracketData.classes.index.tierNote);
  }

  const tiers = [...new Set(roster.map((e) => e.tier))].sort(
    (a, b) => tierRank(a) - tierRank(b) || a.localeCompare(b)
  );

  for (const tier of tiers) {
    const members = roster.filter((e) => e.tier === tier);
    embed.addFields({
      name: `Tier ${tier}`,
      value: members.map((e) => `**${capitalize(e.class)}** \u2014 ${e.summary}`).join('\n')
    });
  }

  if (meta.gameVersion?.clientPatch) {
    embed.setFooter({ text: `WoW Classic Era ${meta.gameVersion.clientPatch}` });
  }

  return { embeds: [embed] };
}
