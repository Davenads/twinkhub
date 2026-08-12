import { SlashCommandBuilder, ChannelType, MessageFlags, PermissionFlagsBits } from 'discord.js';
import { requireManager } from '../../lib/access.js';
import { loadGuildConfig, setStash } from '../../config/guildConfig.js';
import { logger } from '../../lib/logger.js';
import * as store from '../../stash/store.js';
import { buildStashPanel } from '../../services/stash.js';

// Manager-only CRUD over the Community Stash. Thin wrappers around the store
// (the only Postgres seam); this file holds NO game/DB logic beyond formatting.
// setDefaultMemberPermissions(ManageGuild) hides it from non-managers in the
// picker, but the real gate is requireManager at runtime (per-guild Manager role
// OR Manage Server), since default-member-perms is only a client-side hint.

export const data = new SlashCommandBuilder()
  .setName('stashadmin')
  .setDescription('Manage the Community Stash (managers only).')
  .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
  .addSubcommand((s) =>
    s
      .setName('add')
      .setDescription('Add a donated item to the stash.')
      .addStringOption((o) =>
        o.setName('name').setDescription('Item name').setRequired(true).setMaxLength(200)
      )
      .addIntegerOption((o) =>
        o.setName('quantity').setDescription('How many (default 1)').setMinValue(1)
      )
      .addStringOption((o) => o.setName('slot').setDescription('Gear slot (e.g. head, weapon)'))
      .addStringOption((o) => o.setName('donor').setDescription('Who donated it'))
      .addStringOption((o) => o.setName('wowhead_id').setDescription('Wowhead item id'))
      .addStringOption((o) => o.setName('tags').setDescription('Comma-separated tags'))
      .addStringOption((o) => o.setName('notes').setDescription('Free-text notes'))
  )
  .addSubcommand((s) =>
    s
      .setName('list')
      .setDescription('List stash items.')
      .addStringOption((o) =>
        o
          .setName('status')
          .setDescription('Which items (default active)')
          .addChoices(
            { name: 'active (available + requested)', value: 'active' },
            { name: 'all', value: 'all' }
          )
      )
  )
  .addSubcommand((s) =>
    s.setName('queue').setDescription('Show pending requests awaiting approval.')
  )
  .addSubcommand((s) =>
    s
      .setName('approve')
      .setDescription('Approve a pending request.')
      .addStringOption((o) =>
        o.setName('request_id').setDescription('Request id (from queue)').setRequired(true)
      )
  )
  .addSubcommand((s) =>
    s
      .setName('sent')
      .setDescription('Mark an approved request as handed over.')
      .addStringOption((o) =>
        o.setName('request_id').setDescription('Request id').setRequired(true)
      )
  )
  .addSubcommand((s) =>
    s
      .setName('deny')
      .setDescription('Deny an open request.')
      .addStringOption((o) =>
        o.setName('request_id').setDescription('Request id').setRequired(true)
      )
  )
  .addSubcommand((s) =>
    s
      .setName('remove')
      .setDescription('Withdraw an item and cancel its open requests.')
      .addStringOption((o) => o.setName('item_id').setDescription('Item id').setRequired(true))
  )
  .addSubcommandGroup((g) =>
    g
      .setName('panel')
      .setDescription('Manage the public Community Stash panel.')
      .addSubcommand((s) =>
        s
          .setName('post')
          .setDescription('Post the public stash panel into a channel.')
          .addChannelOption((o) =>
            o
              .setName('channel')
              .setDescription('Channel to host the panel (recommended: read-only for @everyone)')
              .addChannelTypes(ChannelType.GuildText)
              .setRequired(true)
          )
      )
      .addSubcommand((s) =>
        s.setName('refresh').setDescription('Re-render the posted stash panel in place.')
      )
      .addSubcommand((s) =>
        s.setName('remove').setDescription('Delete and forget the stash panel.')
      )
  );

// Stable StashError.code -> user-facing text. Anything unmapped falls back to the
// error's own message; truly unknown (non-StashError) failures get a generic line.
const ERROR_MESSAGES = {
  INVALID_INPUT: 'That input is invalid — check the values and try again.',
  ITEM_NOT_FOUND: 'No item with that id in this server.',
  REQUEST_NOT_FOUND: 'No request with that id in this server.',
  ITEM_NOT_AVAILABLE: 'That item is not available.',
  REQUEST_NOT_PENDING: 'That request is not pending approval.',
  REQUEST_NOT_APPROVED: 'That request is not approved yet.',
  REQUEST_NOT_OPEN: 'That request is no longer open.',
  NO_STOCK: 'No stock left for that item.',
  NOT_OWNER: 'Only the requester can do that.'
};

function fmtItem(item) {
  const bits = [`\`${item.id}\` — **${item.name}** \u00d7${item.remaining}/${item.quantity}`];
  bits.push(`[${item.status}]`);
  if (item.slot) bits.push(`(${item.slot})`);
  return bits.join(' ');
}

function fmtRequest(req, itemName) {
  const name = itemName ? `**${itemName}**` : `item \`${req.itemId}\``;
  return `\`${req.id}\` — <@${req.userId}> \u2192 ${name} (\`${req.itemId}\`)`;
}

// Join lines under Discord's 2000-char limit, appending a truncation note.
function joinLines(lines, empty) {
  if (!lines.length) return empty;
  const out = [];
  let len = 0;
  for (const line of lines) {
    if (len + line.length + 1 > 1800) {
      out.push(`\u2026and ${lines.length - out.length} more`);
      break;
    }
    out.push(line);
    len += line.length + 1;
  }
  return out.join('\n');
}

// Never let a public panel ping anyone when it re-renders donor/requester text.
const SEND_OPTS = { allowedMentions: { parse: [] } };

// Build the public panel from live claimable/requested stock (same view the
// s1 refresh button renders), so post/refresh stay in lockstep with the store.
async function renderStashPanel(guildId) {
  const items = await store.listItems(guildId, { statuses: ['available', 'requested'] });
  return buildStashPanel({ items });
}

// Best-effort delete of the stored panel message so post/remove never orphan one.
async function removeStashMessage(guild, stash) {
  const messageId = stash?.panelMessageIds?.browse;
  if (!stash?.channelId || !messageId) return;
  const channel = await guild.channels.fetch(stash.channelId).catch(() => null);
  if (!channel?.isTextBased?.()) return;
  const msg = await channel.messages.fetch(messageId).catch(() => null);
  await msg?.delete().catch(() => {});
}

// `/stashadmin panel post|refresh|remove` — mirrors the /panels post/refresh/
// remove lifecycle but for the single public stash message. Assumes the caller
// already deferred ephemerally; the store errors bubble to execute's catch.
async function handlePanel(interaction, sub) {
  const guildId = interaction.guildId;

  if (sub === 'remove') {
    const cfg = await loadGuildConfig(guildId);
    await removeStashMessage(interaction.guild, cfg.stash);
    await setStash(guildId, { channelId: null, panelMessageIds: null });
    await interaction.editReply('Stash panel removed.');
    return;
  }

  if (sub === 'post') {
    const channel = interaction.options.getChannel('channel', true);
    // Clear any existing panel first so we never leave an orphan behind.
    const cfg = await loadGuildConfig(guildId);
    await removeStashMessage(interaction.guild, cfg.stash);
    const panel = await renderStashPanel(guildId);
    let msg;
    try {
      msg = await channel.send({ ...panel, ...SEND_OPTS });
    } catch {
      await interaction.editReply(
        `Couldn't post in <#${channel.id}> — check I can send messages and embeds there.`
      );
      return;
    }
    await setStash(guildId, { channelId: channel.id, panelMessageIds: { browse: msg.id } });
    await interaction.editReply(
      `Posted the stash panel in <#${channel.id}>. Controls work indefinitely; run \`/stashadmin panel refresh\` after stock changes.`
    );
    return;
  }

  // sub === 'refresh': edit the stored message in place, reposting if it's gone.
  const cfg = await loadGuildConfig(guildId);
  if (!cfg.stash?.channelId) {
    await interaction.editReply(
      'No stash panel is posted yet — run `/stashadmin panel post` first.'
    );
    return;
  }
  const channel = await interaction.guild.channels.fetch(cfg.stash.channelId).catch(() => null);
  if (!channel?.isTextBased?.()) {
    await interaction.editReply(
      'The stash panel channel is gone — run `/stashadmin panel post` to place it somewhere new.'
    );
    return;
  }
  const panel = await renderStashPanel(guildId);
  const existingId = cfg.stash.panelMessageIds?.browse;
  const existing = existingId ? await channel.messages.fetch(existingId).catch(() => null) : null;
  let messageId;
  if (existing) {
    await existing.edit({ ...panel, ...SEND_OPTS });
    messageId = existing.id;
  } else {
    const msg = await channel.send({ ...panel, ...SEND_OPTS });
    messageId = msg.id;
  }
  await setStash(guildId, { channelId: channel.id, panelMessageIds: { browse: messageId } });
  await interaction.editReply(`Refreshed the stash panel in <#${channel.id}>.`);
}

export async function execute(interaction) {
  if (!interaction.inGuild()) {
    await interaction.reply({
      content: 'This command can only be used in a server.',
      flags: MessageFlags.Ephemeral
    });
    return;
  }
  if (!(await requireManager(interaction))) return;
  if (!store.isEnabled()) {
    await interaction.reply({
      content: "The stash isn't set up on this bot yet (storage is unconfigured).",
      flags: MessageFlags.Ephemeral
    });
    return;
  }

  const sub = interaction.options.getSubcommand();
  const guildId = interaction.guildId;
  const managerId = interaction.user.id;

  // Every path hits the remote DB, so defer up front (ephemeral) to avoid the 3s
  // interaction-token timeout, then editReply with the result.
  await interaction.deferReply({ flags: MessageFlags.Ephemeral });

  const group = interaction.options.getSubcommandGroup(false);

  try {
    if (group === 'panel') {
      await handlePanel(interaction, sub);
      return;
    }
    switch (sub) {
      case 'add': {
        const tags = (interaction.options.getString('tags') ?? '')
          .split(',')
          .map((t) => t.trim())
          .filter(Boolean);
        const item = await store.addItem(guildId, {
          name: interaction.options.getString('name', true),
          quantity: interaction.options.getInteger('quantity') ?? 1,
          slot: interaction.options.getString('slot'),
          donor: interaction.options.getString('donor'),
          wowheadId: interaction.options.getString('wowhead_id'),
          notes: interaction.options.getString('notes'),
          tags
        });
        await interaction.editReply(
          `Added **${item.name}** \u00d7${item.quantity} — id \`${item.id}\`.`
        );
        return;
      }
      case 'list': {
        const all = interaction.options.getString('status') === 'all';
        const statuses = all
          ? ['available', 'requested', 'given', 'withdrawn']
          : ['available', 'requested'];
        const items = await store.listItems(guildId, { statuses });
        await interaction.editReply(joinLines(items.map(fmtItem), 'No items in the stash yet.'));
        return;
      }
      case 'queue': {
        const reqs = await store.listRequests(guildId, { statuses: ['pending'] });
        const names = new Map();
        for (const id of new Set(reqs.map((r) => r.itemId))) {
          const item = await store.getItem(guildId, id);
          if (item) names.set(id, item.name);
        }
        await interaction.editReply(
          joinLines(
            reqs.map((r) => fmtRequest(r, names.get(r.itemId))),
            'No pending requests.'
          )
        );
        return;
      }
      case 'approve': {
        const req = await store.approveRequest(
          guildId,
          interaction.options.getString('request_id', true),
          managerId
        );
        await interaction.editReply(
          `Approved request \`${req.id}\`. Mark it \`/stashadmin sent\` once handed over.`
        );
        return;
      }
      case 'sent': {
        const req = await store.markSent(
          guildId,
          interaction.options.getString('request_id', true),
          managerId
        );
        await interaction.editReply(`Marked request \`${req.id}\` as sent.`);
        return;
      }
      case 'deny': {
        const req = await store.denyRequest(
          guildId,
          interaction.options.getString('request_id', true),
          managerId
        );
        await interaction.editReply(`Denied request \`${req.id}\`.`);
        return;
      }
      case 'remove': {
        const item = await store.removeItem(
          guildId,
          interaction.options.getString('item_id', true),
          managerId
        );
        await interaction.editReply(
          `Withdrew \`${item.id}\` (**${item.name}**) and cancelled its open requests.`
        );
        return;
      }
      default:
        await interaction.editReply('Unknown subcommand.');
    }
  } catch (err) {
    if (err instanceof store.StashError) {
      await interaction.editReply(ERROR_MESSAGES[err.code] ?? err.message);
      return;
    }
    logger.error({ err, sub }, 'stashadmin command failed');
    await interaction.editReply('Something went wrong talking to the stash. Try again.');
  }
}
