import { SlashCommandBuilder } from 'discord.js';
import { getContentStore } from '../../content/store.js';
import { resolveBracket } from '../../content/bracket.js';
import { renderXpRules } from '../../services/xprules.js';

// Enduser data command — open to everyone (only admin/ and timer test commands
// are dev-gated). Defaults to the guild's primary bracket; the render logic and
// all copy live in the service + content store, never here.
export const data = new SlashCommandBuilder()
  .setName('xprules')
  .setDescription('How to manage XP and stay in your twink bracket.');

export async function execute(interaction) {
  const bracket = await resolveBracket(interaction);
  const store = await getContentStore();
  const payload = renderXpRules({ store, bracket });

  await interaction.reply({ ...payload, allowedMentions: { parse: [] } });
}
