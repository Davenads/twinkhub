import { MessageFlags } from 'discord.js';
import { requireRequester } from '../lib/access.js';
import { loadGuildConfig } from '../config/guildConfig.js';
import { logger } from '../lib/logger.js';
import * as store from '../stash/store.js';
import { parseStashCustomId, buildStashPanel } from '../services/stash.js';

// Component router for the public Community Stash panel (`s1|` ids). Runs in
// parallel to components/panels.js (the `p1` content panels); index.js forks on
// isStashComponent so the two never cross. No store/DB logic lives here beyond
// wiring — the handlers call the same store methods `/stash` uses.
//
// Gating: `req`/`mine` require a requester role (Twink/Manager/Manage Server);
// `refresh` only re-renders public data so it's open to everyone. Gates reply on
// denial, so they must run BEFORE any deferral.

const SEND_OPTS = { allowedMentions: { parse: [] } };

// Stable StashError.code -> requester-facing text (CAP_REACHED handled inline).
const ERROR_MESSAGES = {
  ITEM_NOT_FOUND: 'That item is no longer in the stash.',
  ITEM_NOT_AVAILABLE: 'That item is no longer available.',
  REQUEST_NOT_FOUND: 'That request no longer exists.'
};

const STATUS_LABELS = {
  pending: 'awaiting approval',
  approved: 'approved \u2014 pending hand-off',
  sent: 'sent'
};

function fmtOwnRequest(req, itemName) {
  const name = itemName ? `**${itemName}**` : `item \`${req.itemId}\``;
  return `\`${req.id}\` \u2014 ${name}: ${STATUS_LABELS[req.status] ?? req.status}`;
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

// After a deferReply(ephemeral), translate a store failure into an editReply.
async function editStoreError(interaction, err, label) {
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
  logger.error({ err }, label);
  await interaction.editReply('Something went wrong talking to the stash. Try again.');
}

// Request select -> claim the chosen item for the clicker.
async function handleRequest(interaction) {
  if (!(await requireRequester(interaction))) return;
  const itemId = interaction.values?.[0];
  if (!itemId) {
    await interaction.reply({ content: 'No item selected.', flags: MessageFlags.Ephemeral });
    return;
  }
  await interaction.deferReply({ flags: MessageFlags.Ephemeral });
  try {
    const cfg = await loadGuildConfig(interaction.guildId);
    const requestCap = cfg.stash?.requestCap ?? 3;
    const req = await store.requestItem(interaction.guildId, itemId, interaction.user.id, {
      requestCap
    });
    await interaction.editReply(
      `Requested \`${req.itemId}\` \u2014 request id \`${req.id}\`. A manager will review it.`
    );
  } catch (err) {
    await editStoreError(interaction, err, 'stash panel request failed');
  }
}

// My Requests button -> the clicker's own open/recent requests.
async function handleMine(interaction) {
  if (!(await requireRequester(interaction))) return;
  await interaction.deferReply({ flags: MessageFlags.Ephemeral });
  try {
    const reqs = await store.listRequests(interaction.guildId, {
      userId: interaction.user.id,
      statuses: ['pending', 'approved', 'sent']
    });
    const names = new Map();
    for (const id of new Set(reqs.map((r) => r.itemId))) {
      const item = await store.getItem(interaction.guildId, id);
      if (item) names.set(id, item.name);
    }
    await interaction.editReply(
      joinLines(
        reqs.map((r) => fmtOwnRequest(r, names.get(r.itemId))),
        'You have no open requests.'
      )
    );
  } catch (err) {
    await editStoreError(interaction, err, 'stash panel mine failed');
  }
}

// Refresh button -> re-render the public panel in place from live stock. Open to
// everyone; deferUpdate then editReply edits the panel message the button rides.
async function handleRefresh(interaction) {
  await interaction.deferUpdate();
  try {
    const items = await store.listItems(interaction.guildId, {
      statuses: ['available', 'requested']
    });
    await interaction.editReply({ ...buildStashPanel({ items }), ...SEND_OPTS });
  } catch (err) {
    logger.error({ err }, 'stash panel refresh failed');
    await interaction
      .followUp({ content: 'Could not refresh the stash panel.', flags: MessageFlags.Ephemeral })
      .catch(() => {});
  }
}

const HANDLERS = {
  req: handleRequest,
  mine: handleMine,
  refresh: handleRefresh
};

/** True when a component interaction targets a stash control (current `s1` id). */
export function isStashComponent(interaction) {
  return parseStashCustomId(interaction?.customId) !== null;
}

/**
 * Dispatch a stash button/select to its handler. Only called by index.js when
 * isStashComponent is true. Degrades gracefully when the stash store is
 * unconfigured and points users at an admin refresh for retired controls.
 */
export async function handleStashComponent(interaction) {
  const parsed = parseStashCustomId(interaction.customId);
  if (!parsed) return;
  if (!store.isEnabled()) {
    await interaction.reply({
      content: "The stash isn't set up on this bot yet.",
      flags: MessageFlags.Ephemeral
    });
    return;
  }
  const handler = HANDLERS[parsed.action];
  if (!handler) {
    await interaction.reply({
      content: 'This stash control is out of date \u2014 ask an admin to refresh the panel.',
      flags: MessageFlags.Ephemeral
    });
    return;
  }
  await handler(interaction);
}
