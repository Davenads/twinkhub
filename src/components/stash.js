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
  buildWithdrawConfirm,
  buildAddWizard,
  buildAddModal,
  normalizeWowheadId,
  pickRestockTarget,
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

// Like editStoreError but for a deferred UPDATE of a component message (the Add
// wizard): also clears the wizard embed/components so only the result text
// remains where the selects used to be.
async function editStoreErrorUpdate(interaction, err, label) {
  let text;
  if (err instanceof store.StashError) {
    text = ERROR_MESSAGES[err.code] ?? err.message;
  } else {
    logger.error({ err }, label);
    text = 'Something went wrong talking to the stash. Try again.';
  }
  await interaction.editReply({ content: text, embeds: [], components: [] });
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

// Withdraw select (`mwd`) -> spawn an ephemeral withdraw confirm for the picked
// item. Counts the item's open requests so the confirm can warn they'll be
// cascade-cancelled by removeItem.
async function handleWithdrawSelect(interaction) {
  if (!(await requireManager(interaction))) return;
  const itemId = interaction.values?.[0];
  if (!itemId) {
    await interaction.reply({ content: 'No item selected.', flags: MessageFlags.Ephemeral });
    return;
  }
  try {
    const item = await store.getItem(interaction.guildId, itemId);
    if (!item) {
      await interaction.reply({
        content: MANAGER_ERROR_MESSAGES.ITEM_NOT_FOUND,
        flags: MessageFlags.Ephemeral
      });
      return;
    }
    const open = await store.listRequests(interaction.guildId, {
      itemId,
      statuses: ['pending', 'approved']
    });
    await interaction.reply({
      ...buildWithdrawConfirm({ item, openCount: open.length }),
      flags: MessageFlags.Ephemeral,
      ...SEND_OPTS
    });
  } catch (err) {
    logger.error({ err }, 'stash withdraw open failed');
    await interaction
      .reply({ content: 'Could not open that item.', flags: MessageFlags.Ephemeral })
      .catch(() => {});
  }
}

// Withdraw confirm (`wdc`) -> withdraw the item (cascade-cancels its open
// requests). Collapses the ephemeral console on success.
async function handleWithdrawConfirm(interaction, parsed) {
  if (!(await requireManager(interaction))) return;
  try {
    const item = await store.removeItem(interaction.guildId, parsed.args[0], interaction.user.id);
    await interaction.update({
      content: `Withdrew **${item.name}** from the stash.`,
      embeds: [],
      components: []
    });
  } catch (err) {
    await updateActionError(interaction, err, 'stash withdraw failed');
  }
}

// Withdraw cancel (`wdcx`) -> back out, leaving the item in place.
async function handleWithdrawCancel(interaction) {
  if (!(await requireManager(interaction))) return;
  await interaction.update({
    content: 'Cancelled \u2014 the item is still in the stash.',
    embeds: [],
    components: []
  });
}

// Add Item button (`madd`) on the manager console -> open the ephemeral Add-Item
// wizard. Manager-gated; a button interaction can reply, so nothing defers before
// the gate (requireManager only replies on denial).
async function handleAddOpen(interaction) {
  if (!(await requireManager(interaction))) return;
  await interaction.reply({
    ...buildAddWizard(),
    flags: MessageFlags.Ephemeral,
    ...SEND_OPTS
  });
}

// Add-Item wizard slot pick (`awslot|<donorId>`) -> re-render the wizard carrying
// the donor already chosen (in the select's id) plus the new slot. Stateless: all
// running state rides the component ids, so a restart never orphans a half add.
async function handleWizardSlot(interaction, parsed) {
  if (!(await requireManager(interaction))) return;
  const slot = interaction.values?.[0] || null;
  const donorId = parsed.args[0] || null;
  await interaction.update({ ...buildAddWizard({ slot, donorId }), ...SEND_OPTS });
}

// Add-Item wizard donor pick (`awdon|<slot>`) -> re-render carrying the slot
// already chosen (in the select's id) plus the new donor.
async function handleWizardDonor(interaction, parsed) {
  if (!(await requireManager(interaction))) return;
  const donorId = interaction.values?.[0] || null;
  const slot = parsed.args[0] || null;
  await interaction.update({ ...buildAddWizard({ slot, donorId }), ...SEND_OPTS });
}

// Add-Item wizard Next (`awnx|<slot>|<donorId>`) -> open the free-text modal,
// carrying the captured slot/donor in its submit id. showModal MUST be the first
// ack, so requireManager (replies only on denial) runs first and nothing defers.
async function handleWizardNext(interaction, parsed) {
  if (!(await requireManager(interaction))) return;
  await interaction.showModal(buildAddModal(parsed.args[0] || null, parsed.args[1] || null));
}

// Add-Item modal submit (`madds|<slot>|<donorId>`) -> combine the modal free text
// with the wizard's captured slot/donor, then intake through the same dedup path
// as `/stashadmin add` (no force_new here, so a match always restocks). The donor
// snowflake resolves to a display name for the text donor column. Edits the
// wizard message in place with the result.
async function handleAddSubmit(interaction, parsed) {
  if (!(await requireManager(interaction))) return;
  await interaction.deferUpdate();
  try {
    const slot = parsed.args[0] || null;
    const donorId = parsed.args[1] || null;
    let donor = null;
    if (donorId) {
      const member = await interaction.guild.members.fetch(donorId).catch(() => null);
      donor = member ? member.displayName : `<@${donorId}>`;
    }
    const f = interaction.fields;
    const name = f.getTextInputValue('name').trim();
    if (!name) {
      await interaction.editReply({
        content: 'An item name is required.',
        embeds: [],
        components: []
      });
      return;
    }
    const rawQty = f.getTextInputValue('quantity').trim();
    const parsedQty = Number.parseInt(rawQty, 10);
    const quantity = Number.isInteger(parsedQty) && parsedQty >= 1 ? parsedQty : 1;
    const wowheadId = normalizeWowheadId(f.getTextInputValue('wowhead'));
    const notes = f.getTextInputValue('notes').trim() || null;

    const guildId = interaction.guildId;
    const matches = await store.findItemMatch(guildId, { wowheadId, name });
    const target = pickRestockTarget(matches, false);
    if (target) {
      const updated = await store.restockItem(guildId, target.id, quantity, { wowheadId, slot });
      await interaction.editReply({
        content: `Restocked **${updated.name}** +${quantity} \u2192 \u00d7${updated.remaining}/${updated.quantity} (id \`${updated.id}\`). Use \`/stashadmin add force_new:true\` for a separate entry.`,
        embeds: [],
        components: []
      });
      return;
    }
    const item = await store.addItem(guildId, { name, quantity, slot, donor, wowheadId, notes });
    await interaction.editReply({
      content: `Added **${item.name}** \u00d7${item.quantity} \u2014 id \`${item.id}\`.`,
      embeds: [],
      components: []
    });
  } catch (err) {
    await editStoreErrorUpdate(interaction, err, 'stash add-modal submit failed');
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
  dcxl: handleDenyCancel,
  mwd: handleWithdrawSelect,
  wdc: handleWithdrawConfirm,
  wdcx: handleWithdrawCancel,
  madd: handleAddOpen,
  awslot: handleWizardSlot,
  awdon: handleWizardDonor,
  awnx: handleWizardNext,
  madds: handleAddSubmit
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
