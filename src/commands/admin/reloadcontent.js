import { SlashCommandBuilder, MessageFlags } from 'discord.js';
import { requireDevRole } from '../../lib/access.js';
import { reloadContentStore, summarizeStore } from '../../content/store.js';

// Dev-only authoring aid: re-reads and re-validates data/content/ into the live
// singleton without a bot restart. A strict reload throws before the cache is
// swapped, so a broken edit is reported while the last-good store keeps serving.
export const data = new SlashCommandBuilder()
  .setName('reloadcontent')
  .setDescription('Reload the content store from disk without restarting the bot (dev only).');

export async function execute(interaction) {
  if (!(await requireDevRole(interaction))) return;
  await interaction.deferReply({ flags: MessageFlags.Ephemeral });

  const result = await reloadContentStore();
  if (!result.ok) {
    const msg = String(result.error?.message ?? result.error).slice(0, 1500);
    await interaction.editReply(
      `Reload failed — keeping the previously loaded content live:\n\`\`\`\n${msg}\n\`\`\``
    );
    return;
  }

  const lines = summarizeStore(result.store).map(
    (s) =>
      `\u2022 **${s.bracket}** \u2014 ${s.classes} classes \u00b7 ${s.enchants} enchants \u00b7 ` +
      `${s.gearItems} gear items \u00b7 ${s.scalingClasses} stat-weight classes`
  );
  const header = `Content reloaded \u2014 serving ${lines.length} bracket(s).`;
  await interaction.editReply(lines.length ? `${header}\n${lines.join('\n')}` : header);
}
