import { SlashCommandBuilder } from 'discord.js';
import { getContentStore } from '../../content/store.js';
import { resolveBracket } from '../../content/bracket.js';
import { renderTierlist } from '../../services/tierlist.js';

// Enduser data command — open to everyone. Defaults to the guild's primary
// bracket; all copy lives in the content store, rendered by the service.
export const data = new SlashCommandBuilder()
  .setName('tierlist')
  .setDescription('Class tier list for a twink bracket.');

export async function execute(interaction) {
  const bracket = await resolveBracket(interaction);
  const store = await getContentStore();
  const payload = renderTierlist({ store, bracket });

  await interaction.reply({ ...payload, allowedMentions: { parse: [] } });
}
