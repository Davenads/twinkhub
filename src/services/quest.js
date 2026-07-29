import { EmbedBuilder } from 'discord.js';
import { capitalize } from '../lib/text.js';
import { bracketQuests, questsFor, getGearItem } from '../content/store.js';

const EMBED_COLOR = 0xc8aa6e;
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
  if (q.xpWarning) lines.push('**XP-risk turn-in** \u2014 awards XP; complete well before dinging 20.');
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
  const title = meta ? `Gear Quests \u2014 ${meta.battleground} ${meta.levelCap}` : 'Gear Quests';
  const embed = new EmbedBuilder().setColor(EMBED_COLOR).setTitle(title);

  if (!data) {
    return { embeds: [embed.setDescription(`No quest data is loaded for bracket **${bracket}**.`)] };
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
        embed.setDescription(
          scope.length
            ? `No quests match ${scope.join(' and ')} in bracket **${bracket}**.`
            : `No quests are authored for bracket **${bracket}**.`
        )
      ]
    };
  }

  const descParts = [];
  if (scope.length) descParts.push(`Filtered to ${scope.join(' and ')}.`);
  if (data.note) descParts.push(data.note);
  if (descParts.length) embed.setDescription(descParts.join('\n\n'));

  for (const q of matches.slice(0, MAX_FIELDS)) {
    embed.addFields({ name: q.name, value: questValue(store, bracket, q) });
  }
  if (matches.length > MAX_FIELDS) {
    embed.addFields({
      name: '\u2026',
      value: `${matches.length - MAX_FIELDS} more not shown \u2014 narrow with a faction or class filter.`
    });
  }

  if (meta?.gameVersion?.clientPatch) {
    embed.setFooter({ text: `WoW Classic Era ${meta.gameVersion.clientPatch}` });
  }

  return { embeds: [embed] };
}
