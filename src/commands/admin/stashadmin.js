import { SlashCommandBuilder, ChannelType, MessageFlags, PermissionFlagsBits } from 'discord.js';
import { requireManager } from '../../lib/access.js';
import { loadGuildConfig, setStash } from '../../config/guildConfig.js';
import { logger } from '../../lib/logger.js';
import * as store from '../../stash/store.js';
import { buildStashPanel, normalizeWowheadId } from '../../services/stash.js';
import { notifyRequester } from '../../stash/notify.js';

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
      .addStringOption((o) =>
        o.setName('wowhead_id').setDescription('Wowhead item id or URL (links the name)')
      )
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
  )
  .addSubcommandGroup((g) =>
    g
      .setName('roles')
      .setDescription('Configure which roles can manage or request from the stash.')
      .addSubcommand((s) =>
        s
          .setName('add')
          .setDescription('Grant a role Manager or Requester access.')
          .addStringOption((o) =>
            o
              .setName('kind')
              .setDescription('Which access to grant')
              .setRequired(true)
              .addChoices(
                { name: 'manager', value: 'manager' },
                { name: 'requester', value: 'requester' }
              )
          )
          .addRoleOption((o) => o.setName('role').setDescription('Role to grant').setRequired(true))
      )
      .addSubcommand((s) =>
        s
          .setName('remove')
          .setDescription('Revoke a role\u2019s Manager or Requester access.')
          .addStringOption((o) =>
            o
              .setName('kind')
              .setDescription('Which access to revoke')
              .setRequired(true)
              .addChoices(
                { name: 'manager', value: 'manager' },
                { name: 'requester', value: 'requester' }
              )
          )
          .addRoleOption((o) =>
            o.setName('role').setDescription('Role to revoke').setRequired(true)
          )
      )
      .addSubcommand((s) =>
        s
          .setName('clear')
          .setDescription('Remove all roles of one kind.')
          .addStringOption((o) =>
            o
              .setName('kind')
              .setDescription('Which access to clear')
              .setRequired(true)
              .addChoices(
                { name: 'manager', value: 'manager' },
                { name: 'requester', value: 'requester' }
              )
          )
      )
      .addSubcommand((s) =>
        s.setName('show').setDescription('Show the configured Manager and Requester roles.')
      )
  )
  .addSubcommandGroup((g) =>
    g
      .setName('config')
      .setDescription('Configure stash notifications and view tunables.')
      .addSubcommand((s) =>
        s
          .setName('channel')
          .setDescription('Set (or clear) the channel where new-request notifications post.')
          .addChannelOption((o) =>
            o
              .setName('channel')
              .setDescription('Manager notify channel; omit to clear')
              .addChannelTypes(ChannelType.GuildText)
          )
      )
      .addSubcommand((s) =>
        s
          .setName('set')
          .setDescription('Set the request cap and/or stale-approval days.')
          .addIntegerOption((o) =>
            o
              .setName('request_cap')
              .setDescription('Max open requests one member may hold (default 3)')
              .setMinValue(1)
              .setMaxValue(25)
          )
          .addIntegerOption((o) =>
            o
              .setName('stale_approval_days')
              .setDescription('Days before an un-sent approval reverts to pending (default 5)')
              .setMinValue(1)
              .setMaxValue(60)
          )
      )
      .addSubcommand((s) =>
        s.setName('show').setDescription('Show the stash configuration and tunables.')
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

// `kind` option value -> stash config key + human label. Managers gate approvals;
// requesters (Twinks) gate the request/claim flow. Both are string[] of role ids.
const ROLE_KEYS = { manager: 'managerRoleIds', requester: 'requesterRoleIds' };
const ROLE_LABELS = { manager: 'Manager', requester: 'Requester/Twink' };

// Pure array mutators (exported for unit tests). Tolerate null/absent input,
// dedupe on add, and always return a fresh cleaned string[].
export function addRoleId(ids, id) {
  const list = Array.isArray(ids) ? ids.filter(Boolean) : [];
  return list.includes(id) ? list : [...list, id];
}
export function removeRoleId(ids, id) {
  const list = Array.isArray(ids) ? ids.filter(Boolean) : [];
  return list.filter((x) => x !== id);
}

function fmtRoleList(ids) {
  const list = Array.isArray(ids) ? ids.filter(Boolean) : [];
  return list.length ? list.map((id) => `<@&${id}>`).join(', ') : '_none configured_';
}

// `/stashadmin roles add|remove|clear|show` — edits the per-guild Manager/Requester
// role allow-lists that back requireManager/requireRequester. Gated on Manage Server
// (not just Manager) in execute, so a plain Manager can't grow the roster. Assumes
// the caller already deferred ephemerally.
async function handleRoles(interaction, sub) {
  const guildId = interaction.guildId;
  const cfg = await loadGuildConfig(guildId);

  if (sub === 'show') {
    await interaction.editReply(
      'Stash roles for this server:\n' +
        `\u2022 Managers: ${fmtRoleList(cfg.stash?.managerRoleIds)}\n` +
        `\u2022 Requesters (Twink): ${fmtRoleList(cfg.stash?.requesterRoleIds)}`
    );
    return;
  }

  const kind = interaction.options.getString('kind', true);
  const key = ROLE_KEYS[kind];
  const label = ROLE_LABELS[kind];

  if (sub === 'clear') {
    await setStash(guildId, { [key]: [] });
    await interaction.editReply(`Cleared all ${label} roles.`);
    return;
  }

  const role = interaction.options.getRole('role', true);
  const current = cfg.stash?.[key];
  if (sub === 'add') {
    await setStash(guildId, { [key]: addRoleId(current, role.id) });
    await interaction.editReply(`Added <@&${role.id}> as a ${label} role.`);
    return;
  }
  // sub === 'remove'
  await setStash(guildId, { [key]: removeRoleId(current, role.id) });
  await interaction.editReply(`Removed <@&${role.id}> from ${label} roles.`);
}

// `/stashadmin config channel|set|show` — the manager notify channel, the request
// cap / stale-approval-days tunables, and a read-only view of every stash setting.
// Gated on Manage Server in execute (like roles).
async function handleConfig(interaction, sub) {
  const guildId = interaction.guildId;
  const cfg = await loadGuildConfig(guildId);

  if (sub === 'set') {
    // Apply only the provided option(s); Discord enforces the 1..25 / 1..60 bounds.
    const requestCap = interaction.options.getInteger('request_cap', false);
    const staleApprovalDays = interaction.options.getInteger('stale_approval_days', false);
    if (requestCap == null && staleApprovalDays == null) {
      await interaction.editReply('Provide request_cap and/or stale_approval_days to set.');
      return;
    }
    const patch = {};
    if (requestCap != null) patch.requestCap = requestCap;
    if (staleApprovalDays != null) patch.staleApprovalDays = staleApprovalDays;
    await setStash(guildId, patch);
    await interaction.editReply(
      'Updated stash tunables:\n' +
        `\u2022 Request cap: ${patch.requestCap ?? cfg.stash?.requestCap ?? 3}\n` +
        `\u2022 Stale-approval days: ${patch.staleApprovalDays ?? cfg.stash?.staleApprovalDays ?? 5}`
    );
    return;
  }

  if (sub === 'show') {
    const s = cfg.stash ?? {};
    const channel = s.managerChannelId ? `<#${s.managerChannelId}>` : '_none configured_';
    await interaction.editReply(
      'Stash configuration:\n' +
        `\u2022 Manager notify channel: ${channel}\n` +
        `\u2022 Request cap: ${s.requestCap ?? 3}\n` +
        `\u2022 Stale-approval days: ${s.staleApprovalDays ?? 5}\n` +
        `\u2022 Managers: ${fmtRoleList(s.managerRoleIds)}\n` +
        `\u2022 Requesters (Twink): ${fmtRoleList(s.requesterRoleIds)}`
    );
    return;
  }

  // sub === 'channel': set when provided, clear when omitted.
  const channel = interaction.options.getChannel('channel', false);
  if (!channel) {
    await setStash(guildId, { managerChannelId: null });
    await interaction.editReply('Cleared the manager notification channel.');
    return;
  }
  await setStash(guildId, { managerChannelId: channel.id });
  await interaction.editReply(
    `New-request notifications will post to <#${channel.id}> and ping the Manager role(s).`
  );
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
    if (group === 'roles' || group === 'config') {
      // Tighter than requireManager: editing the roster / notify wiring is
      // self-escalation-sensitive, so require Manage Server, not merely a
      // configured Manager role.
      if (!interaction.member?.permissions?.has?.(PermissionFlagsBits.ManageGuild)) {
        await interaction.editReply('Only members with **Manage Server** can configure the stash.');
        return;
      }
      if (group === 'roles') await handleRoles(interaction, sub);
      else await handleConfig(interaction, sub);
      return;
    }
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
          wowheadId: normalizeWowheadId(interaction.options.getString('wowhead_id')),
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
        // Fire-and-forget: a failed DM must never break the manager's action.
        notifyRequester(interaction.client, guildId, { req, kind: 'approved' }).catch(() => {});
        return;
      }
      case 'sent': {
        const req = await store.markSent(
          guildId,
          interaction.options.getString('request_id', true),
          managerId
        );
        await interaction.editReply(`Marked request \`${req.id}\` as sent.`);
        notifyRequester(interaction.client, guildId, { req, kind: 'sent' }).catch(() => {});
        return;
      }
      case 'deny': {
        const req = await store.denyRequest(
          guildId,
          interaction.options.getString('request_id', true),
          managerId
        );
        await interaction.editReply(`Denied request \`${req.id}\`.`);
        notifyRequester(interaction.client, guildId, { req, kind: 'denied' }).catch(() => {});
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
