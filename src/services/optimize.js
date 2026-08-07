import { EmbedBuilder } from 'discord.js';
import { capitalize } from '../lib/text.js';
import {
  getClass,
  gearForClass,
  gearSlots,
  getEnchant,
  consumablesFor,
  questsFor
} from '../content/store.js';
import {
  EMBED_COLOR,
  LIMITS,
  truncate,
  field,
  metaTitle,
  metaFooter,
  degradeEmbed
} from '../lib/embed.js';

// Keep any single list within Discord's 1024-char field-value cap.
const MAX_LIST = 15;

/**
 * The "did you forget X" pass: a pure cross-reference over already-loaded content
 * for one class (optionally scoped to a faction). It derives every check from the
 * store — no new data file, no hardcoded game knowledge:
 *   - core-slot coverage (declared gear slots vs slots with a faction-appropriate
 *     `core` pick),
 *   - the recommended enchants carried by those core items (flagging no-level-req),
 *   - consumables and gear quests to pick up (XP-risk turn-ins flagged),
 *   - reminders drawn from item `source` types (profession/PvP) and the class's
 *     authored `factionNotes`.
 *
 * @param {{ store: object, bracket: string, className: string, faction?: string|null }} args
 * @returns {{ embeds: EmbedBuilder[] }}
 */
export function renderOptimize({ store, bracket, className, faction = null }) {
  const meta = store?.brackets?.[bracket]?.meta;
  const classKey = String(className ?? '').toLowerCase();
  const factionKey = faction ? String(faction).toLowerCase() : null;
  const title = metaTitle(`Optimize ${capitalize(classKey)}`, meta);

  const cls = getClass(store, bracket, classKey);
  if (!cls) {
    return {
      embeds: [
        degradeEmbed(
          title,
          `No data for class **${capitalize(classKey)}** in bracket **${bracket}**.`
        )
      ]
    };
  }

  const gear = gearForClass(store, bracket, classKey);
  if (!gear) {
    return {
      embeds: [
        degradeEmbed(
          title,
          `No gear list is authored for **${capitalize(classKey)}** in bracket **${bracket}**, so there is nothing to optimize yet.`
        )
      ]
    };
  }

  const embed = new EmbedBuilder().setColor(EMBED_COLOR).setTitle(title);

  const scope = [`class **${capitalize(classKey)}**`];
  if (factionKey) scope.push(`faction **${capitalize(factionKey)}**`);
  embed.setDescription(truncate(`Gap checklist for ${scope.join(', ')}.`, LIMITS.description));

  const factionOk = (it) => !factionKey || it.faction === factionKey || it.faction === 'both';
  const coreItems = gear.items.filter((it) => it.priority === 'core' && factionOk(it));

  // 1) Core-slot coverage: declared slots vs slots with a core pick in scope.
  const slots = gearSlots(store, bracket);
  const coveredSlots = new Set(coreItems.map((it) => it.slot));
  const missing = slots.filter((s) => !coveredSlots.has(s));
  embed.addFields(
    field(
      `Core slot coverage \u2014 ${slots.length - missing.length}/${slots.length}`,
      missing.length
        ? `Missing a core pick for: ${missing.join(', ')}.`
        : 'Every declared slot has a core pick.'
    )
  );

  // 2) Enchants to apply: recommended enchants attached to the in-scope core items.
  const enchantLines = [];
  for (const it of coreItems) {
    if (it.enchant == null) continue;
    const ench = getEnchant(store, bracket, it.enchant);
    if (!ench) continue;
    enchantLines.push(`${it.name}: ${ench.name}${ench.noLevelReq ? ' (no level req)' : ''}`);
  }
  embed.addFields(
    field(
      'Enchants to apply',
      enchantLines.length
        ? enchantLines.slice(0, MAX_LIST).join('\n')
        : 'No enchant recommendations on your core items yet.'
    )
  );

  // 3) Consumables to carry (class-specific plus universal). Surface class-specific
  // ones first so a player's unique picks aren't dropped by the display cap.
  const cons = consumablesFor(store, bracket, { className: classKey });
  const orderedCons = [...cons].sort((a, b) => Number(!!b.classes) - Number(!!a.classes));
  embed.addFields(
    field(
      'Consumables to carry',
      orderedCons.length
        ? orderedCons
            .slice(0, MAX_LIST)
            .map((c) => `${c.name} (${c.type})`)
            .join('\n')
        : 'No consumables authored for this bracket yet.'
    )
  );

  // 4) Gear quests worth doing, flagging XP-risk turn-ins (the core twink concern).
  const quests = questsFor(store, bracket, { faction: factionKey, className: classKey });
  if (quests.length) {
    embed.addFields(
      field(
        'Gear quests worth doing',
        quests
          .slice(0, MAX_LIST)
          .map((q) => `${q.name}${q.xpWarning ? ' \u2014 XP-risk turn-in' : ''}`)
          .join('\n')
      )
    );
  }

  // 5) Reminders derived from item source types + the class's faction notes.
  const reminders = [];
  const uniqueNames = (items) => [...new Set(items.map((it) => it.name))];
  const profItems = coreItems.filter((it) => it.source?.type === 'profession');
  if (profItems.length) reminders.push(`Profession pickups: ${uniqueNames(profItems).join(', ')}.`);
  const pvpItems = coreItems.filter((it) => it.source?.type === 'pvp');
  if (pvpItems.length) {
    reminders.push(
      `PvP reward(s): ${uniqueNames(pvpItems).join(', ')} \u2014 mind the item-level requirement.`
    );
  }
  if (cls.factionNotes) reminders.push(cls.factionNotes);
  if (reminders.length) embed.addFields(field('Reminders', reminders.join('\n\n')));

  const footerText = metaFooter(meta);
  if (footerText) embed.setFooter({ text: footerText });

  return { embeds: [embed] };
}
