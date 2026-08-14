import { MessageFlags } from 'discord.js';
import { requireRequester, requireManager } from '../lib/access.js';
import { loadGuildConfig } from '../config/guildConfig.js';
import { logger } from '../lib/logger.js';
import * as store from '../stash/store.js';
import {
  parseStashCustomId,
  buildStashPanel,
  buildManagerPanel,
  buildRequestAction,
  buildDenyConfirm,
  itemNames
} from '../services/stash.js';
import { notifyNewRequest, notifyRequester } from '../stash/notify.js';

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
    // Fire-and-forget: never block or fail the requester's confirm on notify.
    notifyNewRequest(interaction.client, interaction.guildId, {
      req,
      requesterId: interaction.user.id
    }).catch(() => {});
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

// Manager Console Refresh -> re-render the manager panel in place from live
// counts. Manager-gated (the panel lives in a manager-only channel, but never
// trust the channel alone). requireManager replies on denial, so it runs BEFORE
// deferUpdate.
async function handleManagerRefresh(interaction) {
  if (!(await requireManager(interaction))) return;
  await interaction.deferUpdate();
  try {
    const [items, pending, approved] = await Promise.all([
      store.listItems(interaction.guildId, { statuses: ['available', 'requested'] }),
      store.listRequests(interaction.guildId, { statuses: ['pending'] }),
      store.listRequests(interaction.guildId, { statuses: ['approved'] })
    ]);
    await interaction.editReply({
      ...buildManagerPanel({ items, pending, approved, names: itemNames(items) }),
      ...SEND_OPTS
    });
  } catch (err) {
    logger.error({ err }, 'stash manager panel refresh failed');
    await interaction
      .followUp({ content: 'Could not refresh the manager panel.', flags: MessageFlags.Ephemeral })
      .catch(() => {});
  }
}

// Stable StashError.code -> manager-facing text for the action console. A racy
// click (someone else already handled it, or stock ran out) resolves to a clear
// reason instead of a thrown error.
const MANAGER_ERROR_MESSAGES = {
  REQUEST_NOT_FOUND: 'That request no longer exists.',
  REQUEST_NOT_PENDING: 'That request is no longer pending \u2014 someone may have handled it.',
  REQUEST_NOT_APPROVED: 'That request is not in the approved state anymore.',
  REQUEST_NOT_OPEN: 'That request is already closed.',
  NO_STOCK: 'No stock is left to fulfil that request.',
  ITEM_NOT_FOUND: 'That item is no longer in the stash.'
};

// Collapse the ephemeral action console into the store's stable reason (or a
// generic line) when an action can't proceed. Falls back to a followUp if the
// interaction was already acknowledged.
async function updateActionError(interaction, err, label) {
  const text =
    err instanceof store.StashError
      ? (MANAGER_ERROR_MESSAGES[err.code] ?? err.message)
      : 'Something went wrong talking to the stash. Try again.';
  if (!(err instanceof store.StashError)) logger.error({ err }, label);
  try {
    await interaction.update({ content: text, embeds: [], components: [] });
  } catch {
    await interaction.followUp({ content: text, flags: MessageFlags.Ephemeral }).catch(() => {});
  }
}

// Collapse the console into a plain confirmation (no buttons) after a decision,
// then DM the requester. The DM is fire-and-forget so a closed DM never fails the
// manager's action.
async function finishAction(interaction, req, kind, text) {
  await interaction.update({ content: text, embeds: [], components: [] });
  notifyRequester(interaction.client, interaction.guildId, { req, kind }).catch(() => {});
}

// Manager console select (pending `mq` / approved `maq`) -> spawn an EPHEMERAL
// per-request action console. Never edits the shared panel message, so two
// managers can act at once without stomping each other. Reads authoritative
// state so a stale option (already handled) surfaces cleanly.
async function handleConsoleSelect(interaction) {
  if (!(await requireManager(interaction))) return;
  const reqId = interaction.values?.[0];
  if (!reqId) {
    await interaction.reply({ content: 'No request selected.', flags: MessageFlags.Ephemeral });
    return;
  }
  try {
    const req = await store.getRequest(interaction.guildId, reqId);
    if (!req) {
      await interaction.reply({
        content: MANAGER_ERROR_MESSAGES.REQUEST_NOT_FOUND,
        flags: MessageFlags.Ephemeral
      });
      return;
    }
    const item = await store.getItem(interaction.guildId, req.itemId).catch(() => null);
    await interaction.reply({
      ...buildRequestAction({ req, itemName: item?.name }),
      flags: MessageFlags.Ephemeral,
      ...SEND_OPTS
    });
  } catch (err) {
    logger.error({ err }, 'stash manager console open failed');
    await interaction
      .reply({ content: 'Could not open that request.', flags: MessageFlags.Ephemeral })
      .catch(() => {});
  }
}

// Approve button (`aprv`) on the ephemeral console -> approve the request.
async function handleApprove(interaction, parsed) {
  if (!(await requireManager(interaction))) return;
  try {
    const req = await store.approveRequest(
      interaction.guildId,
      parsed.args[0],
      interaction.user.id
    );
    await finishAction(
      interaction,
      req,
      'approved',
      `Approved request \`${req.id}\`. The requester has been notified.`
    );
  } catch (err) {
    await updateActionError(interaction, err, 'stash approve failed');
  }
}

// Mark Sent button (`sent`) on the ephemeral console -> mark an approved request
// handed over (decrements stock).
async function handleSent(interaction, parsed) {
  if (!(await requireManager(interaction))) return;
  try {
    const req = await store.markSent(interaction.guildId, parsed.args[0], interaction.user.id);
    await finishAction(
      interaction,
      req,
      'sent',
      `Marked request \`${req.id}\` as sent. The requester has been notified.`
    );
  } catch (err) {
    await updateActionError(interaction, err, 'stash mark-sent failed');
  }
}

// Deny button (`deny`), step 1 -> replace the console with a Yes/No confirm so a
// mis-click can't free a reserved unit and fire a requester DM.
async function handleDenyPrompt(interaction, parsed) {
  if (!(await requireManager(interaction))) return;
  try {
    const req = await store.getRequest(interaction.guildId, parsed.args[0]);
    if (!req) {
      await interaction.update({
        content: MANAGER_ERROR_MESSAGES.REQUEST_NOT_FOUND,
        embeds: [],
        components: []
      });
      return;
    }
    const item = await store.getItem(interaction.guildId, req.itemId).catch(() => null);
    await interaction.update({ ...buildDenyConfirm({ req, itemName: item?.name }), ...SEND_OPTS });
  } catch (err) {
    await updateActionError(interaction, err, 'stash deny prompt failed');
  }
}

// Deny confirm (`denyc`), step 2 -> deny the request for real.
async function handleDenyConfirm(interaction, parsed) {
  if (!(await requireManager(interaction))) return;
  try {
    const req = await store.denyRequest(interaction.guildId, parsed.args[0], interaction.user.id);
    await finishAction(
      interaction,
      req,
      'denied',
      `Denied request \`${req.id}\`. The requester has been notified.`
    );
  } catch (err) {
    await updateActionError(interaction, err, 'stash deny failed');
  }
}

// Deny cancel (`dcxl`) -> back out of the confirm to the action console.
async function handleDenyCancel(interaction, parsed) {
  if (!(await requireManager(interaction))) return;
  try {
    const req = await store.getRequest(interaction.guildId, parsed.args[0]);
    if (!req) {
      await interaction.update({
        content: MANAGER_ERROR_MESSAGES.REQUEST_NOT_FOUND,
        embeds: [],
        components: []
      });
      return;
    }
    const item = await store.getItem(interaction.guildId, req.itemId).catch(() => null);
    await interaction.update({
      ...buildRequestAction({ req, itemName: item?.name }),
      ...SEND_OPTS
    });
  } catch (err) {
    await updateActionError(interaction, err, 'stash deny cancel failed');
  }
}

const HANDLERS = {
  req: handleRequest,
  mine: handleMine,
  refresh: handleRefresh,
  mref: handleManagerRefresh,
  mq: handleConsoleSelect,
  maq: handleConsoleSelect,
  aprv: handleApprove,
  sent: handleSent,
  deny: handleDenyPrompt,
  denyc: handleDenyConfirm,
  dcxl: handleDenyCancel
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
  await handler(interaction, parsed);
}
