import { SlashCommandBuilder, ChannelType, MessageFlags } from 'discord.js';
import { requireDevRole } from '../../lib/access.js';
import { loadGuildConfig, setPanels } from '../../config/guildConfig.js';
import { getContentStore } from '../../content/store.js';
import { resolveBracket } from '../../content/bracket.js';
import { buildPanels } from '../../services/panels.js';

// Dev-gated admin command to manage the persistent enduser panels (P4). `post`
// drops the full panel set (embeds + button/select controls) into a channel and
// records each message id; `refresh` re-renders them in place (self-healing a
// deleted one); `remove` deletes and forgets them. The controls themselves are
// stateless and survive restarts — see plans/08-enduser-panels.md.
export const data = new SlashCommandBuilder()
  .setName('panels')
  .setDescription('Manage the interactive enduser panels for this server (dev only).')
  .addSubcommand((s) =>
    s
      .setName('post')
      .setDescription('Post the interactive panels into a channel (recommended: read-only for @everyone).')
      .addChannelOption((o) =>
        o
          .setName('channel')
          .setDescription('Channel to host the panels')
          .addChannelTypes(ChannelType.GuildText)
          .setRequired(true)
      )
  )
  .addSubcommand((s) =>
    s.setName('refresh').setDescription('Re-render the posted panels in place (reposts any that were deleted).')
  )
  .addSubcommand((s) => s.setName('remove').setDescription('Delete and forget the panels.'));

/** Best-effort delete of every stored panel message. */
async function removeExistingPanels(guild, panels) {
  if (!panels?.channelId || !panels?.messageIds) return;
  const channel = await guild.channels.fetch(panels.channelId).catch(() => null);
  if (!channel?.isTextBased?.()) return;
  for (const messageId of Object.values(panels.messageIds)) {
    const msg = await channel.messages.fetch(messageId).catch(() => null);
    await msg?.delete().catch(() => {});
  }
}

const SEND_OPTS = { allowedMentions: { parse: [] } };

/**
 * Post every panel fresh into `channel`, returning the panels record to persist.
 * Used by both `post` and by `refresh` when there's no channel/message to edit.
 */
async function postAll(channel, built) {
  const messageIds = {};
  for (const panel of built) {
    const msg = await channel.send({ embeds: panel.embeds, components: panel.components, ...SEND_OPTS });
    messageIds[panel.key] = msg.id;
  }
  return { channelId: channel.id, messageIds };
}

export async function execute(interaction) {
  if (!(await requireDevRole(interaction))) return;
  if (!interaction.inGuild()) {
    await interaction.reply({ content: 'This command can only be used in a server.', flags: MessageFlags.Ephemeral });
    return;
  }

  const sub = interaction.options.getSubcommand();

  if (sub === 'remove') {
    const cfg = await loadGuildConfig(interaction.guildId);
    await removeExistingPanels(interaction.guild, cfg.panels);
    await setPanels(interaction.guildId, null);
    await interaction.reply({ content: 'Panels removed.', flags: MessageFlags.Ephemeral });
    return;
  }

  await interaction.deferReply({ flags: MessageFlags.Ephemeral });
  const store = await getContentStore();
  const bracket = await resolveBracket(interaction);
  const built = buildPanels({ store, bracket });
  if (!built.length) {
    await interaction.editReply('No content is loaded for this bracket, so there are no panels to post.');
    return;
  }

  if (sub === 'post') {
    const channel = interaction.options.getChannel('channel', true);
    // Clear any existing panels first so we never leave orphaned messages behind.
    const cfg = await loadGuildConfig(interaction.guildId);
    await removeExistingPanels(interaction.guild, cfg.panels);
    let record;
    try {
      record = await postAll(channel, built);
    } catch {
      await interaction.editReply(`Couldn't post in <#${channel.id}> — check I can send messages and embeds there.`);
      return;
    }
    await setPanels(interaction.guildId, record);
    await interaction.editReply(
      `Posted ${built.length} panel(s) in <#${channel.id}>. Buttons work indefinitely; run \`/panels refresh\` after content changes.`
    );
    return;
  }

  // sub === 'refresh'
  const cfg = await loadGuildConfig(interaction.guildId);
  if (!cfg.panels?.channelId) {
    await interaction.editReply('No panels are posted yet — run `/panels post` first.');
    return;
  }
  const channel = await interaction.guild.channels.fetch(cfg.panels.channelId).catch(() => null);
  if (!channel?.isTextBased?.()) {
    await interaction.editReply('The panels channel is gone — run `/panels post` to place them somewhere new.');
    return;
  }

  const prev = cfg.panels.messageIds ?? {};
  const builtKeys = new Set(built.map((p) => p.key));
  const messageIds = {};
  for (const panel of built) {
    const existingId = prev[panel.key];
    const existing = existingId ? await channel.messages.fetch(existingId).catch(() => null) : null;
    if (existing) {
      await existing.edit({ embeds: panel.embeds, components: panel.components, ...SEND_OPTS });
      messageIds[panel.key] = existing.id;
    } else {
      const msg = await channel.send({ embeds: panel.embeds, components: panel.components, ...SEND_OPTS });
      messageIds[panel.key] = msg.id;
    }
  }
  // Drop any stored panels whose key no longer builds (e.g. content removed).
  for (const [key, id] of Object.entries(prev)) {
    if (builtKeys.has(key)) continue;
    const stale = await channel.messages.fetch(id).catch(() => null);
    await stale?.delete().catch(() => {});
  }

  await setPanels(interaction.guildId, { channelId: channel.id, messageIds });
  await interaction.editReply(`Refreshed ${built.length} panel(s) in <#${channel.id}>.`);
}
