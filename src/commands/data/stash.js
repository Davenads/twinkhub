import { SlashCommandBuilder, MessageFlags } from 'discord.js';
import { requireRequester } from '../../lib/access.js';
import { loadGuildConfig } from '../../config/guildConfig.js';
import { logger } from '../../lib/logger.js';
import * as store from '../../stash/store.js';

// Enduser side of the Community Stash. Browsing is open to everyone in the
// server; requesting/cancelling is gated on requireRequester (Twink role, or a
// Manager / Manage Server). Thin wrappers over the store (the only Postgres
// seam) — no game/DB logic here beyond formatting.

export const data = new SlashCommandBuilder()
  .setName('stash')
  .setDescription('Browse and request donated items from the Community Stash.')
  .addSubcommand((s) =>
    s.setName('browse').setDescription('See what donated items are up for grabs.')
  )
  .addSubcommand((s) =>
    s
      .setName('request')
      .setDescription('Request an item from the stash.')
      .addStringOption((o) =>
        o.setName('item_id').setDescription('Item id (from /stash browse)').setRequired(true)
      )
  )
  .addSubcommand((s) => s.setName('mine').setDescription('See your own stash requests.'))
  .addSubcommand((s) =>
    s
      .setName('cancel')
      .setDescription('Cancel one of your open requests.')
      .addStringOption((o) =>
        o.setName('request_id').setDescription('Request id (from /stash mine)').setRequired(true)
      )
  );

// Stable StashError.code -> requester-facing text. Unmapped codes fall back to the
// error message; non-StashError failures get a generic line.
const ERROR_MESSAGES = {
  ITEM_NOT_FOUND: 'No item with that id in this server.',
  REQUEST_NOT_FOUND: 'No request with that id in this server.',
  ITEM_NOT_AVAILABLE: 'That item is no longer available.',
  REQUEST_NOT_OPEN: 'That request is no longer open.',
  NOT_OWNER: 'You can only cancel your own requests.'
};

// Human labels for a requester's own request states.
const STATUS_LABELS = {
  pending: 'awaiting approval',
  approved: 'approved — pending hand-off',
  sent: 'sent'
};

function fmtItem(item) {
  const bits = [`\`${item.id}\` — **${item.name}** \u00d7${item.remaining}`];
  if (item.slot) bits.push(`(${item.slot})`);
  if (item.status === 'requested') bits.push('_(all claimed)_');
  return bits.join(' ');
}

function fmtOwnRequest(req, itemName) {
  const name = itemName ? `**${itemName}**` : `item \`${req.itemId}\``;
  return `\`${req.id}\` — ${name}: ${STATUS_LABELS[req.status] ?? req.status}`;
}

// Join lines under Discord's message limit, appending a truncation note.
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

export async function execute(interaction) {
  if (!interaction.inGuild()) {
    await interaction.reply({
      content: 'This command can only be used in a server.',
      flags: MessageFlags.Ephemeral
    });
    return;
  }
  if (!store.isEnabled()) {
    await interaction.reply({
      content: "The stash isn't set up on this bot yet.",
      flags: MessageFlags.Ephemeral
    });
    return;
  }

  const sub = interaction.options.getSubcommand();
  const guildId = interaction.guildId;
  const userId = interaction.user.id;

  // `browse` is open to everyone; the other subs require a requester role. Gate
  // before deferring so requireRequester can reply on denial.
  if (sub !== 'browse' && !(await requireRequester(interaction))) return;

  await interaction.deferReply({ flags: MessageFlags.Ephemeral });

  try {
    switch (sub) {
      case 'browse': {
        const items = await store.listItems(guildId, { statuses: ['available', 'requested'] });
        await interaction.editReply(
          joinLines(items.map(fmtItem), 'The stash is empty right now.')
        );
        return;
      }
      case 'request': {
        const cfg = await loadGuildConfig(guildId);
        const requestCap = cfg.stash?.requestCap ?? 3;
        const itemId = interaction.options.getString('item_id', true);
        const req = await store.requestItem(guildId, itemId, userId, { requestCap });
        await interaction.editReply(
          `Requested \`${req.itemId}\` — request id \`${req.id}\`. A manager will review it.`
        );
        return;
      }
      case 'mine': {
        const reqs = await store.listRequests(guildId, {
          userId,
          statuses: ['pending', 'approved', 'sent']
        });
        const names = new Map();
        for (const id of new Set(reqs.map((r) => r.itemId))) {
          const item = await store.getItem(guildId, id);
          if (item) names.set(id, item.name);
        }
        await interaction.editReply(
          joinLines(
            reqs.map((r) => fmtOwnRequest(r, names.get(r.itemId))),
            'You have no open requests.'
          )
        );
        return;
      }
      case 'cancel': {
        const req = await store.cancelRequest(
          guildId,
          interaction.options.getString('request_id', true),
          userId
        );
        await interaction.editReply(`Cancelled request \`${req.id}\`.`);
        return;
      }
      default:
        await interaction.editReply('Unknown subcommand.');
    }
  } catch (err) {
    if (err instanceof store.StashError) {
      if (err.code === 'CAP_REACHED') {
        await interaction.editReply(
          "You're at your open-request limit. Cancel one with `/stash cancel` first."
        );
        return;
      }
      await interaction.editReply(ERROR_MESSAGES[err.code] ?? err.message);
      return;
    }
    logger.error({ err, sub }, 'stash command failed');
    await interaction.editReply('Something went wrong talking to the stash. Try again.');
  }
}
