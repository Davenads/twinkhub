import { EmbedBuilder } from 'discord.js';

// Muted gold — matches the timer embeds so the bot reads as one identity.
const EMBED_COLOR = 0xc8aa6e;

/**
 * Render a bracket's XP-management rules entirely from `meta.json` data — no
 * game knowledge is baked into code (01-architecture.md: handlers thin, data
 * fat). Returns a renderable payload so both the `/xprules` slash command and,
 * later, the reference panel handler call this exact function and only differ in
 * the flags they attach.
 *
 * @param {{ store: object, bracket: string }} args
 * @returns {{ embeds: EmbedBuilder[] }}
 */
export function renderXpRules({ store, bracket }) {
  const entry = store?.brackets?.[bracket];
  if (!entry) {
    return {
      embeds: [
        new EmbedBuilder()
          .setColor(EMBED_COLOR)
          .setTitle('XP Rules')
          .setDescription(`No content is loaded for bracket **${bracket}**.`)
      ]
    };
  }

  const { meta } = entry;
  const [minLevel] = meta.levelRange;
  const cap = meta.levelCap;

  const embed = new EmbedBuilder()
    .setColor(EMBED_COLOR)
    .setTitle(`XP Rules \u2014 ${meta.battleground} ${minLevel}\u2013${cap}`)
    .setDescription(`**Level cap:** ${cap}. A character that dings ${cap + 1} leaves the bracket.`)
    .addFields({
      name: meta.xpLock.available ? 'XP toggle' : 'No XP-off toggle',
      value: meta.xpLock.note
    });

  if (meta.gameVersion?.clientPatch) {
    embed.setFooter({ text: `WoW Classic Era ${meta.gameVersion.clientPatch}` });
  }

  return { embeds: [embed] };
}
