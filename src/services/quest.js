import { EmbedBuilder } from 'discord.js';
import { capitalize } from '../lib/text.js';
import { bracketQuests, questsFor, getGearItem } from '../content/store.js';
import {
  EMBED_COLOR,
  LIMITS,
  truncate,
  field,
  metaTitle,
  metaFooter,
  degradeEmbed
} from '../lib/embed.js';

// Discord caps embeds at 25 fields; one quest per field.
const MAX_FIELDS = 25;

/** Reward text: prefer a resolved gear item's name, else the free-text desc. */
function rewardText(store, bracket, reward) {
  if (!reward) return 'Unknown';
  if (reward.itemId) {
    const item = getGearItem(store, bracket, reward.itemId);
    if (item) return item.name;
  }
  return reward.desc ?? reward.itemId ?? 'Unknown';
}

function questValue(store, bracket, q) {
  const lines = [];
  if (q.xpWarning)
    lines.push('**XP-risk turn-in** \u2014 awards XP; complete well before dinging 20.');
  lines.push(`Reward: ${rewardText(store, bracket, q.reward)}`);
  const meta = [];
  if (q.zone) meta.push(q.zone);
  meta.push(capitalize(q.faction));
  if (Array.isArray(q.classes)) meta.push(q.classes.map(capitalize).join(', '));
  lines.push(meta.join(' \u00b7 '));
  if (q.notes) lines.push(q.notes);
  return lines.join('\n');
}

/**
 * Render a bracket's gear-reward quests, optionally filtered by `faction` and/or
 * `className`, flagging XP-risk turn-ins prominently (the core twink XP-management
 * concern). Reward item ids resolve to their gear-item name; free-text rewards
 * show as authored. All copy comes from `quests.json`.
 *
 * @param {{ store: object, bracket: string, faction?: string|null, className?: string|null }} args
 * @returns {{ embeds: EmbedBuilder[] }}
 */
export function renderQuest({ store, bracket, faction = null, className = null }) {
  const data = bracketQuests(store, bracket);
  const meta = store?.brackets?.[bracket]?.meta;
  const title = metaTitle('Gear Quests', meta);

  if (!data) {
    return { embeds: [degradeEmbed(title, `No quest data is loaded for bracket **${bracket}**.`)] };
  }

  const factionKey = faction ? String(faction).toLowerCase() : null;
  const classKey = className ? String(className).toLowerCase() : null;
  const matches = questsFor(store, bracket, { faction: factionKey, className: classKey });

  const scope = [
    factionKey ? `faction **${capitalize(factionKey)}**` : null,
    classKey ? `class **${capitalize(classKey)}**` : null
  ].filter(Boolean);

  if (!matches.length) {
    return {
      embeds: [
        degradeEmbed(
          title,
          scope.length
            ? `No quests match ${scope.join(' and ')} in bracket **${bracket}**.`
            : `No quests are authored for bracket **${bracket}**.`
        )
      ]
    };
  }

  const embed = new EmbedBuilder().setColor(EMBED_COLOR).setTitle(title);

  const descParts = [];
  if (scope.length) descParts.push(`Filtered to ${scope.join(' and ')}.`);
  if (data.note) descParts.push(data.note);
  if (descParts.length) embed.setDescription(truncate(descParts.join('\n\n'), LIMITS.description));

  for (const q of matches.slice(0, MAX_FIELDS)) {
    embed.addFields(field(q.name, questValue(store, bracket, q)));
  }
  if (matches.length > MAX_FIELDS) {
    embed.addFields(
      field(
        '\u2026',
        `${matches.length - MAX_FIELDS} more not shown \u2014 narrow with a faction or class filter.`
      )
    );
  }

  const footerText = metaFooter(meta);
  if (footerText) embed.setFooter({ text: footerText });

  return { embeds: [embed] };
}
