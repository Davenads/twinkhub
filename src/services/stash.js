import {
  EmbedBuilder,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  StringSelectMenuBuilder,
  UserSelectMenuBuilder,
  ModalBuilder,
  TextInputBuilder,
  TextInputStyle
} from 'discord.js';
import { EMBED_COLOR, DEGRADE_COLOR, truncate, LIMITS } from '../lib/embed.js';
import { itemNameMarkup } from './gearFormat.js';

// Community Stash panel layer — the public `#stash` message and its versioned
// component-id contract. Mirrors services/panels.js but for a DYNAMIC inventory:
// the panel is rebuilt from a live items array (listItems), so the request
// control is a select menu of current items rather than fixed buttons. This
// module builds messages and encodes/parses ids only; the component router
// (components/stash.js) calls the store. Pure and unit-testable — no DB, no env.

// Version prefix on every stash component id. Bumping (s1 -> s2) makes the router
// treat previously-posted panels as stale. Kept distinct from the content panels'
// `p1` so the two routers never collide on a customId.
export const STASH_VERSION = 's1';
const SEP = '|';

// Discord allows at most 25 options in a select menu.
const SELECT_LIMIT = 25;

// Canonical equipment-slot taxonomy for the stash, in paper-doll order. value is
// the stored id; label is the dropdown/section display. Single source of truth so
// the add-command choices and (later) the panel grouping never drift; non-gear
// donations omit slot and render under Ungrouped.
export const STASH_SLOTS = [
  { value: 'head', label: 'Head' },
  { value: 'neck', label: 'Neck' },
  { value: 'shoulder', label: 'Shoulder' },
  { value: 'back', label: 'Back (Cloak)' },
  { value: 'shirt', label: 'Shirt' },
  { value: 'chest', label: 'Chest' },
  { value: 'wrist', label: 'Wrist' },
  { value: 'hands', label: 'Hands' },
  { value: 'waist', label: 'Waist' },
  { value: 'legs', label: 'Legs' },
  { value: 'feet', label: 'Feet' },
  { value: 'finger', label: 'Finger' },
  { value: 'trinket', label: 'Trinket' },
  { value: 'weapon', label: 'Weapon' },
  { value: 'offhand', label: 'Held In Off-hand' },
  { value: 'shield', label: 'Shield' },
  { value: 'ranged', label: 'Ranged' }
];

/** Encode a stash component id: `s1|action|arg...`. */
export function encodeStashId(action, ...args) {
  return [STASH_VERSION, action, ...args].join(SEP);
}

/**
 * Parse a stash component id. Returns `{ action, args }` for a current (`s1`) id,
 * or null for anything else (a content-panel `p1` id, a foreign component, or a
 * stale version) so the router/audit can treat it as not-ours.
 */
export function parseStashCustomId(customId) {
  if (typeof customId !== 'string') return null;
  const parts = customId.split(SEP);
  if (parts[0] !== STASH_VERSION || parts.length < 2 || !parts[1]) return null;
  return { action: parts[1], args: parts.slice(2) };
}

const row = (...components) => new ActionRowBuilder().addComponents(...components);

/**
 * Normalize a free-text Wowhead item id into a bare positive-integer string, or
 * null. Accepts a plain id (`"12977"`) or a pasted Classic URL
 * (`".../classic/item=12977/slug"`) \u2014 anything else (a name, junk, empty)
 * yields null so the render never emits a broken link. Shared by `/stashadmin
 * add` (intake) and the panel (render), since the `add` option is free text.
 */
export function normalizeWowheadId(raw) {
  if (raw == null) return null;
  const s = String(raw).trim();
  if (/^\d+$/.test(s)) return s;
  const m = s.match(/item=(\d+)/i);
  return m ? m[1] : null;
}

// Canonical value -> display label, and value -> paper-doll order, derived once
// from STASH_SLOTS so grouping never drifts from the add-command choices.
const SLOT_LABEL = new Map(STASH_SLOTS.map((s) => [s.value, s.label]));

// Legacy free-text slot -> canonical value. Pre-dropdown donations were typed by
// hand, so fold the common synonyms into a canonical bucket; anything unresolved
// falls through to Ungrouped rather than spawning a one-off section.
const SLOT_ALIASES = {
  gloves: 'hands',
  glove: 'hands',
  boots: 'feet',
  boot: 'feet',
  bracer: 'wrist',
  bracers: 'wrist',
  belt: 'waist',
  cloak: 'back',
  ring: 'finger',
  mainhand: 'weapon',
  'main hand': 'weapon',
  '2h-weapon': 'weapon',
  '2h': 'weapon',
  'off-hand': 'offhand',
  'off hand': 'offhand'
};

/**
 * Normalize a slot value to its canonical STASH_SLOTS id, or null (=> Ungrouped).
 * Accepts a canonical id as-is, folds a known legacy synonym, and rejects unknown
 * free text so a typo can't fragment the grouping.
 */
export function normalizeSlot(raw) {
  if (raw == null) return null;
  const s = String(raw).trim().toLowerCase();
  if (!s) return null;
  if (SLOT_LABEL.has(s)) return s;
  return SLOT_ALIASES[s] ?? null;
}

/** One display line per item: name, remaining count, and claimed marker. Slot is
 * carried by the group subheader, so it is intentionally omitted here. */
function itemLine(item) {
  const name = itemNameMarkup({ name: item.name, wowheadId: normalizeWowheadId(item.wowheadId) });
  const bits = [`${name} \u00d7${item.remaining}`];
  if (item.status === 'requested' || item.remaining < 1) bits.push('\u2014 _all claimed_');
  return `\u2022 ${bits.join(' ')}`;
}

/**
 * Group items by canonical slot in paper-doll order, sorted by name within each
 * group, with a trailing "Ungrouped" bucket for slotless/unresolved donations.
 * Returns an ordered array of `{ label, items }` — the shared ordering used by
 * both the description subheaders and the request select.
 */
function groupBySlot(items) {
  const groups = new Map();
  const ungrouped = [];
  for (const it of items) {
    const slot = normalizeSlot(it.slot);
    if (slot) {
      if (!groups.has(slot)) groups.set(slot, []);
      groups.get(slot).push(it);
    } else {
      ungrouped.push(it);
    }
  }
  const byName = (a, b) => String(a.name).localeCompare(String(b.name));
  const out = [];
  for (const { value, label } of STASH_SLOTS) {
    const arr = groups.get(value);
    if (arr && arr.length) out.push({ value, label, items: arr.slice().sort(byName) });
  }
  if (ungrouped.length)
    out.push({ value: 'ungrouped', label: 'Ungrouped', items: ungrouped.slice().sort(byName) });
  return out;
}

// The canonical slot id used to route an Ungrouped (slotless) bucket's request
// select \u2014 kept distinct from every STASH_SLOTS value so it can't collide.
const UNGROUPED_SLOT = 'ungrouped';

// One request-select option per claimable item: label is the item name, value is
// the item id the request handler routes on, description carries slot + remaining.
// Capped at SELECT_LIMIT so a caller can pass an oversized list safely.
function claimOptions(items) {
  return items.slice(0, SELECT_LIMIT).map((it) => {
    const opt = { label: truncate(it.name, 100), value: it.id };
    const slotLabel = SLOT_LABEL.get(normalizeSlot(it.slot)) || it.slot;
    const desc = [slotLabel, `\u00d7${it.remaining} left`].filter(Boolean).join(' \u00b7 ');
    if (desc) opt.description = truncate(desc, 100);
    return opt;
  });
}

/** Only items a requester can actually claim right now populate the dropdown. */
function claimable(items) {
  return items.filter((it) => it.status === 'available' && it.remaining > 0);
}

// Statuses a manager can act on (edit/withdraw), in the order they surface: live
// stock first, given-history last so it never crowds active items off a select.
const MANAGE_ORDER = { available: 0, requested: 1, given: 2 };

/** Items a manager can edit/withdraw (excludes withdrawn), active-first then name. */
function manageable(items) {
  return items
    .filter((it) => it.status in MANAGE_ORDER)
    .sort((a, b) => {
      const d = MANAGE_ORDER[a.status] - MANAGE_ORDER[b.status];
      return d !== 0 ? d : String(a.name).localeCompare(String(b.name));
    });
}

// One manage-select option per item: label is the name, value is the item id the
// manage handler routes on, description carries a no-link warning + slot + status
// + remaining. Capped at SELECT_LIMIT so a caller can pass an oversized list.
function manageOptions(items) {
  return items.slice(0, SELECT_LIMIT).map((it) => {
    const opt = { label: truncate(it.name, 100), value: it.id };
    const slotLabel = SLOT_LABEL.get(normalizeSlot(it.slot)) || it.slot;
    const noLink = normalizeWowheadId(it.wowheadId) == null ? '\u26a0 no link' : null;
    const desc = [noLink, slotLabel, it.status, `\u00d7${it.remaining}`]
      .filter(Boolean)
      .join(' \u00b7 ');
    if (desc) opt.description = truncate(desc, 100);
    return opt;
  });
}

/** itemId -> display name lookup, for labelling request selects by item. */
export function itemNames(items = []) {
  return Object.fromEntries(items.map((it) => [it.id, it.name]));
}

/**
 * Decide whether an add merges into an existing item (restock) or inserts a
 * fresh row. `matches` is store.findItemMatch's active-item list (earliest
 * first); with force_new set we always insert. Returns the restock target or
 * null for a new insert. Pure so both `/stashadmin add` and the Add-Item modal
 * share one tested decision; the callers run the store side-effects.
 */
export function pickRestockTarget(matches, forceNew) {
  if (forceNew) return null;
  return Array.isArray(matches) && matches.length ? matches[0] : null;
}

/**
 * Build the Add-Item wizard opened by the manager console's Add Item button.
 * Discord modals can't hold selects or user-pickers, so the guardrailed fields
 * are picked FIRST as components — slot via a StringSelect (mirrors the slash
 * choices) and donor via a UserSelect (the native member picker) — and their
 * compact values (canonical slot id, donor snowflake) ride the component ids so
 * the flow stays STATELESS across a restart. Each pick re-renders in place; the
 * `Next: details` button (awnx) then opens buildAddModal for the free text. Both
 * picks are optional (min 0) — clearing a StringSelect leaves the slot unset.
 *
 * @param {{ slot?: string|null, donorId?: string|null }} [state]
 * @returns {{ embeds: EmbedBuilder[], components: ActionRowBuilder[] }}
 */
export function buildAddWizard({ slot = null, donorId = null } = {}) {
  const embed = new EmbedBuilder()
    .setColor(EMBED_COLOR)
    .setTitle('Add stash item')
    .setDescription(
      [
        'Pick the slot and donor below (both optional), then **Next: details** to enter the name, quantity, Wowhead id, and notes.',
        '',
        `Slot: **${SLOT_LABEL.get(slot) || '\u2014'}**`,
        `Donor: ${donorId ? `<@${donorId}>` : '**\u2014**'}`
      ].join('\n')
    );

  const slotSelect = new StringSelectMenuBuilder()
    .setCustomId(encodeStashId('awslot', donorId ?? ''))
    .setPlaceholder('Slot (optional)\u2026')
    .setMinValues(0)
    .setMaxValues(1)
    .addOptions(
      STASH_SLOTS.map((s) => ({ label: s.label, value: s.value, default: s.value === slot }))
    );

  const donorSelect = new UserSelectMenuBuilder()
    .setCustomId(encodeStashId('awdon', slot ?? ''))
    .setPlaceholder('Donor (optional)\u2026')
    .setMinValues(0)
    .setMaxValues(1);
  if (donorId) donorSelect.setDefaultUsers([donorId]);

  const next = new ButtonBuilder()
    .setCustomId(encodeStashId('awnx', slot ?? '', donorId ?? ''))
    .setLabel('Next: details')
    .setStyle(ButtonStyle.Primary);

  return { embeds: [embed], components: [row(slotSelect), row(donorSelect), row(next)] };
}

/**
 * Build the Add-Item details modal opened by the wizard's Next button. Slot and
 * donor were already captured as guardrailed components and ride the submit id
 * (`madds|<slot>|<donorId>`, empty segment = unset), so this modal holds only the
 * free text: name (required), quantity, Wowhead id, and notes. There is no
 * force_new here, so a modal add always dedup-merges. The handler reads fields by
 * these customIds and slot/donor from the id args.
 *
 * @param {string|null} [slot] canonical slot id captured by the wizard
 * @param {string|null} [donorId] donor snowflake captured by the wizard
 * @returns {ModalBuilder}
 */
export function buildAddModal(slot = null, donorId = null) {
  const input = (id, label, { style = TextInputStyle.Short, required = false, max } = {}) => {
    const b = new TextInputBuilder().setCustomId(id).setLabel(label).setStyle(style);
    b.setRequired(required);
    if (max) b.setMaxLength(max);
    return new ActionRowBuilder().addComponents(b);
  };
  return new ModalBuilder()
    .setCustomId(encodeStashId('madds', slot ?? '', donorId ?? ''))
    .setTitle('Add stash item')
    .addComponents(
      input('name', 'Item name', { required: true, max: 200 }),
      input('quantity', 'Quantity (default 1)', { max: 6 }),
      input('wowhead', 'Wowhead item id or URL \u2014 optional', { max: 200 }),
      input('notes', 'Notes \u2014 optional', { style: TextInputStyle.Paragraph, max: 500 })
    );
}

/**
 * Build up-to-25 select options for a request list. The label carries the item
 * name (falling back to the raw item id) so managers act by item, not opaque
 * request id; the option value is the request id the handler routes on. `names`
 * maps itemId -> display name (see itemNames).
 */
function requestOptions(requests, names = {}) {
  return requests.slice(0, SELECT_LIMIT).map((req) => ({
    label: truncate(names[req.itemId] || `item ${req.itemId}`, 100),
    value: req.id,
    description: truncate(`request ${req.id}`, 100)
  }));
}

/**
 * Build the public stash panel message from a live items array. Returns
 * `{ embeds, components }`. When nothing is claimable the request select is
 * omitted (an empty/claimed stash still shows the list + My Requests/Refresh).
 *
 * @param {{ items: Array<{id,name,slot,remaining,status}> }} args
 * @returns {{ embeds: EmbedBuilder[], components: ActionRowBuilder[] }}
 */
export function buildStashPanel({ items = [] } = {}) {
  const open = claimable(items);
  const hasAny = items.length > 0;

  const description = hasAny
    ? groupBySlot(items)
        .map((g) => `**${g.label}**\n${g.items.map(itemLine).join('\n')}`)
        .join('\n\n')
    : 'The stash is empty right now. Check back after the next donation drop.';

  // Order the request select to match the grouped description.
  const orderedOpen = groupBySlot(open).flatMap((g) => g.items);

  const embed = new EmbedBuilder()
    .setColor(hasAny ? EMBED_COLOR : DEGRADE_COLOR)
    .setTitle('Community Stash')
    .setDescription(truncate(description, LIMITS.description));

  const components = [];
  if (open.length && open.length <= SELECT_LIMIT) {
    // Small stash: one flat request select of every claimable item.
    const select = new StringSelectMenuBuilder()
      .setCustomId(encodeStashId('req'))
      .setPlaceholder('Request an item\u2026')
      .addOptions(claimOptions(orderedOpen));
    components.push(row(select));
  } else if (open.length) {
    // More claimable items than a select can hold: a flat list would silently
    // drop items 26+ (un-requestable). Offer a slot picker instead; picking a
    // slot opens an ephemeral request select scoped to that slot (handleRequest
    // Slot -> buildSlotRequestPrompt), so every item stays claimable.
    const select = new StringSelectMenuBuilder()
      .setCustomId(encodeStashId('reqslot'))
      .setPlaceholder('Browse by slot to request\u2026')
      .addOptions(
        groupBySlot(open)
          .slice(0, SELECT_LIMIT)
          .map((g) => ({
            label: truncate(g.label, 100),
            value: g.value,
            description: truncate(`${g.items.length} available`, 100)
          }))
      );
    components.push(row(select));
  }

  components.push(
    row(
      new ButtonBuilder()
        .setCustomId(encodeStashId('mine'))
        .setLabel('My Requests')
        .setStyle(ButtonStyle.Secondary),
      new ButtonBuilder()
        .setCustomId(encodeStashId('refresh'))
        .setLabel('Refresh')
        .setStyle(ButtonStyle.Secondary)
    )
  );

  return { embeds: [embed], components };
}

/**
 * Build the EPHEMERAL request select scoped to a single slot, opened when a big
 * stash's public panel routes a shopper through the slot picker (buildStashPanel
 * -> reqslot). Ephemeral so drilling in never mutates the shared public message.
 * `slot` is a canonical STASH_SLOTS value or the UNGROUPED_SLOT sentinel; only
 * claimable items in that slot are offered. Returns a `{ content, components }`
 * message (no embed) — an empty slot yields a plain refresh hint, no select.
 *
 * @param {{ items?: Array, slot?: string }} args
 * @returns {{ content: string, components: ActionRowBuilder[] }}
 */
export function buildSlotRequestPrompt({ items = [], slot } = {}) {
  const wanted = slot === UNGROUPED_SLOT ? null : slot;
  const label = slot === UNGROUPED_SLOT ? 'Ungrouped' : SLOT_LABEL.get(slot) || String(slot);
  const inSlot = claimable(items)
    .filter((it) => normalizeSlot(it.slot) === wanted)
    .sort((a, b) => String(a.name).localeCompare(String(b.name)));

  if (!inSlot.length) {
    return {
      content: `No **${label}** items are claimable right now \u2014 hit Refresh on the stash.`,
      components: []
    };
  }

  const select = new StringSelectMenuBuilder()
    .setCustomId(encodeStashId('req'))
    .setPlaceholder(`Request a ${label} item\u2026`)
    .addOptions(claimOptions(inSlot));

  let content = `**${label}** \u2014 pick an item to request:`;
  if (inSlot.length > SELECT_LIMIT) {
    content += `\n_Showing the first ${SELECT_LIMIT}; claim some to see the rest._`;
  }
  return { content, components: [row(select)] };
}

/**
 * Build the EPHEMERAL manage select scoped to a single slot, opened when a big
 * stash's manager console routes through the slot picker (buildManagerPanel ->
 * mslot). Ephemeral so drilling in never mutates the shared console message.
 * `slot` is a canonical STASH_SLOTS value or the UNGROUPED_SLOT sentinel; only
 * manageable items (available/requested/given) in that slot are offered,
 * active-first then name. Returns a `{ content, components }` message (no embed)
 * \u2014 an empty slot yields a plain refresh hint, no select.
 *
 * @param {{ items?: Array, slot?: string }} args
 * @returns {{ content: string, components: ActionRowBuilder[] }}
 */
export function buildManageSlotPrompt({ items = [], slot } = {}) {
  const wanted = slot === UNGROUPED_SLOT ? null : slot;
  const label = slot === UNGROUPED_SLOT ? 'Ungrouped' : SLOT_LABEL.get(slot) || String(slot);
  const inSlot = manageable(items).filter((it) => normalizeSlot(it.slot) === wanted);

  if (!inSlot.length) {
    return {
      content: `No **${label}** items to manage right now \u2014 hit Refresh on the console.`,
      components: []
    };
  }

  const select = new StringSelectMenuBuilder()
    .setCustomId(encodeStashId('mitem'))
    .setPlaceholder(`Manage a ${label} item\u2026`)
    .addOptions(manageOptions(inSlot));

  let content = `**${label}** \u2014 pick an item to manage:`;
  if (inSlot.length > SELECT_LIMIT) {
    content += `\n_Showing the first ${SELECT_LIMIT}; handle some to see the rest._`;
  }
  return { content, components: [row(select)] };
}

/**
 * Build the Manager Console panel — a manager-only dashboard posted in a
 * restricted channel. Shows request/stock counts plus Pending/Approved selects:
 * picking a request spawns an ephemeral per-request action console (buildRequest
 * Action) so managers never edit this shared message. Each select is omitted
 * when its list is empty; a Refresh button re-renders the counts in place.
 *
 * @param {{ items?: Array, pending?: Array, approved?: Array, names?: object }} args
 * @returns {{ embeds: EmbedBuilder[], components: ActionRowBuilder[] }}
 */
export function buildManagerPanel({ items = [], pending = [], approved = [], names = {} } = {}) {
  const inStock = items.filter((it) => it.status === 'available' && it.remaining > 0);
  const availableUnits = inStock.reduce((n, it) => n + it.remaining, 0);

  const embed = new EmbedBuilder()
    .setColor(EMBED_COLOR)
    .setTitle('Community Stash \u2014 Manager Console')
    .setDescription(
      [
        `**Pending** (awaiting approval): **${pending.length}**`,
        `**Approved** (awaiting hand-off): **${approved.length}**`,
        `**Available items**: **${inStock.length}** (${availableUnits} unit${availableUnits === 1 ? '' : 's'})`
      ].join('\n')
    )
    .setFooter({ text: 'Pick a request below to approve, deny, or mark it sent.' });

  const components = [];
  if (pending.length) {
    components.push(
      row(
        new StringSelectMenuBuilder()
          .setCustomId(encodeStashId('mq'))
          .setPlaceholder('Review a pending request\u2026')
          .addOptions(requestOptions(pending, names))
      )
    );
  }
  if (approved.length) {
    components.push(
      row(
        new StringSelectMenuBuilder()
          .setCustomId(encodeStashId('maq'))
          .setPlaceholder('Hand off an approved request\u2026')
          .addOptions(requestOptions(approved, names))
      )
    );
  }
  // Manage-item console: every non-withdrawn item (available/requested/given) is
  // editable or withdrawable, active stock first. Mirrors the public request
  // control: a small list is one flat select; a bigger-than-25 list would
  // silently drop items 26+, so offer a slot picker whose pick opens an
  // ephemeral manage select scoped to that slot (handleManageSlot ->
  // buildManageSlotPrompt), keeping every item reachable.
  const manageList = manageable(items);
  if (manageList.length && manageList.length <= SELECT_LIMIT) {
    components.push(
      row(
        new StringSelectMenuBuilder()
          .setCustomId(encodeStashId('mitem'))
          .setPlaceholder('Manage an item\u2026')
          .addOptions(manageOptions(manageList))
      )
    );
  } else if (manageList.length) {
    components.push(
      row(
        new StringSelectMenuBuilder()
          .setCustomId(encodeStashId('mslot'))
          .setPlaceholder('Browse by slot to manage\u2026')
          .addOptions(
            groupBySlot(manageList)
              .slice(0, SELECT_LIMIT)
              .map((g) => ({
                label: truncate(g.label, 100),
                value: g.value,
                description: truncate(`${g.items.length} to manage`, 100)
              }))
          )
      )
    );
  }
  components.push(
    row(
      new ButtonBuilder()
        .setCustomId(encodeStashId('madd'))
        .setLabel('Add Item')
        .setStyle(ButtonStyle.Primary),
      new ButtonBuilder()
        .setCustomId(encodeStashId('mref'))
        .setLabel('Refresh')
        .setStyle(ButtonStyle.Secondary)
    )
  );

  return { embeds: [embed], components };
}

/**
 * Build the ephemeral per-request action console spawned when a manager picks a
 * request from a console select. A pending request offers Approve + Deny; an
 * already-approved one offers Mark Sent. `itemName` may be null (deleted/racy) —
 * we fall back to the raw item id. Ephemeral + allowedMentions:{parse:[]} at the
 * send site keep the `<@user>` line from pinging.
 *
 * @param {{ req: object, itemName?: string|null }} args
 * @returns {{ embeds: EmbedBuilder[], components: ActionRowBuilder[] }}
 */
export function buildRequestAction({ req, itemName } = {}) {
  const name = itemName ? `**${itemName}**` : `item \`${req.itemId}\``;
  const embed = new EmbedBuilder()
    .setColor(EMBED_COLOR)
    .setTitle('Stash request')
    .setDescription(
      [
        name,
        `Requester: <@${req.userId}>`,
        `Status: ${req.status}`,
        `Request id: \`${req.id}\``
      ].join('\n')
    );

  const buttons =
    req.status === 'approved'
      ? [
          new ButtonBuilder()
            .setCustomId(encodeStashId('sent', req.id))
            .setLabel('Mark Sent')
            .setStyle(ButtonStyle.Success)
        ]
      : [
          new ButtonBuilder()
            .setCustomId(encodeStashId('aprv', req.id))
            .setLabel('Approve')
            .setStyle(ButtonStyle.Success),
          new ButtonBuilder()
            .setCustomId(encodeStashId('deny', req.id))
            .setLabel('Deny')
            .setStyle(ButtonStyle.Danger)
        ];

  return { embeds: [embed], components: [row(...buttons)] };
}

/**
 * Build the two-click deny confirmation that replaces the action console when a
 * manager clicks Deny — a guard so a mis-click can't free a reserved unit and
 * fire a requester DM. Confirm routes `denyc`; Cancel routes `dcxl`.
 *
 * @param {{ req: object, itemName?: string|null }} args
 * @returns {{ embeds: EmbedBuilder[], components: ActionRowBuilder[] }}
 */
export function buildDenyConfirm({ req, itemName } = {}) {
  const name = itemName ? `**${itemName}**` : `item \`${req.itemId}\``;
  const embed = new EmbedBuilder()
    .setColor(DEGRADE_COLOR)
    .setTitle('Deny this request?')
    .setDescription(`${name} \u2014 <@${req.userId}> will be notified. This can't be undone.`);
  return {
    embeds: [embed],
    components: [
      row(
        new ButtonBuilder()
          .setCustomId(encodeStashId('denyc', req.id))
          .setLabel('Confirm deny')
          .setStyle(ButtonStyle.Danger),
        new ButtonBuilder()
          .setCustomId(encodeStashId('dcxl', req.id))
          .setLabel('Cancel')
          .setStyle(ButtonStyle.Secondary)
      )
    ]
  };
}

/**
 * Build the ephemeral two-click confirm spawned when a manager picks an item from
 * the console's Withdraw select. removeItem is destructive (cascade-cancels the
 * item's open pending/approved requests), so `openCount` surfaces how many will
 * be cancelled. Confirm routes `wdc`; Cancel routes `wdcx`.
 *
 * @param {{ item: object, openCount?: number }} args
 * @returns {{ embeds: EmbedBuilder[], components: ActionRowBuilder[] }}
 */
export function buildWithdrawConfirm({ item, openCount = 0 } = {}) {
  const lines = [
    `**${item.name}** \u2014 \u00d7${item.remaining} in stock`,
    "Withdrawing pulls it from the stash. This can't be undone."
  ];
  if (openCount > 0) {
    lines.push(`Note: ${openCount} open request${openCount === 1 ? '' : 's'} will be cancelled.`);
  }
  const embed = new EmbedBuilder()
    .setColor(DEGRADE_COLOR)
    .setTitle('Withdraw this item?')
    .setDescription(lines.join('\n'));
  return {
    embeds: [embed],
    components: [
      row(
        new ButtonBuilder()
          .setCustomId(encodeStashId('wdc', item.id))
          .setLabel('Confirm withdraw')
          .setStyle(ButtonStyle.Danger),
        new ButtonBuilder()
          .setCustomId(encodeStashId('wdcx', item.id))
          .setLabel('Cancel')
          .setStyle(ButtonStyle.Secondary)
      )
    ]
  };
}

/**
 * Given the just-edited item id and findItemMatch results (active items sharing
 * the item's new normalized name/id), return a soft consolidation hint naming the
 * OTHER item, or null when the only match is the item itself (or none). Editing
 * never merges — this just flags the collision a rename can create so a manager
 * can consolidate deliberately. Pure/exported for the slash + panel edit paths.
 */
export function collisionNote(itemId, matches) {
  const other = (Array.isArray(matches) ? matches : []).find((m) => m.id !== itemId);
  if (!other) return null;
  return `\u26a0 Now matches \`${other.id}\` (**${other.name}**) \u2014 consider consolidating.`;
}

/**
 * Build the ephemeral manage-item console spawned when a manager picks an item
 * from the console's `mitem` select. Offers Edit (opens the edit wizard, `medit`)
 * and Withdraw (opens the withdraw confirm, `wdp`), both carrying the item id.
 * Detail mirrors `/stashadmin list`.
 *
 * @param {{ item: object }} args
 * @returns {{ embeds: EmbedBuilder[], components: ActionRowBuilder[] }}
 */
export function buildItemAction({ item } = {}) {
  const wowheadId = normalizeWowheadId(item.wowheadId);
  const name = itemNameMarkup({ name: item.name, wowheadId });
  const slotLabel = SLOT_LABEL.get(normalizeSlot(item.slot)) || item.slot || '\u2014';
  const embed = new EmbedBuilder()
    .setColor(EMBED_COLOR)
    .setTitle('Manage item')
    .setDescription(
      [
        `${name} \u00d7${item.remaining}/${item.quantity} [${item.status}]`,
        wowheadId == null ? '\u26a0 No Wowhead link \u2014 add one via Edit.' : null,
        `Slot: ${slotLabel}`,
        `Donor: ${item.donor || '\u2014'}`,
        `Item id: \`${item.id}\``
      ]
        .filter(Boolean)
        .join('\n')
    );
  return {
    embeds: [embed],
    components: [
      row(
        new ButtonBuilder()
          .setCustomId(encodeStashId('medit', item.id))
          .setLabel('Edit')
          .setStyle(ButtonStyle.Primary),
        new ButtonBuilder()
          .setCustomId(encodeStashId('wdp', item.id))
          .setLabel('Withdraw')
          .setStyle(ButtonStyle.Danger)
      )
    ]
  };
}

/**
 * Build the ephemeral Edit wizard opened from the manage-item console's Edit
 * button. Mirrors the Add wizard's stateless picks-first shape but carries the
 * item id, and slot is PREFILLED to the item's current slot (deselect to clear).
 * The donor picker starts empty — the stored donor is free text, not a snowflake,
 * so it can't seed a member picker; leaving it empty keeps the current donor,
 * picking a member overwrites it. `Next: edit details` (ewnx) opens buildEditModal.
 *
 * @param {object} item the item being edited
 * @param {{ slot?: string|null, donorId?: string|null }} [state]
 * @returns {{ embeds: EmbedBuilder[], components: ActionRowBuilder[] }}
 */
export function buildEditWizard(item, { slot = normalizeSlot(item.slot), donorId = null } = {}) {
  const embed = new EmbedBuilder()
    .setColor(EMBED_COLOR)
    .setTitle(`Edit ${item.name}`)
    .setDescription(
      [
        'Adjust the slot and/or donor below, then **Next: edit details** for the name, Wowhead id, and notes.',
        '',
        `Slot: **${SLOT_LABEL.get(slot) || '\u2014'}**`,
        donorId ? `Donor \u2192 <@${donorId}>` : `Donor: ${item.donor || '\u2014'} _(unchanged)_`
      ].join('\n')
    );

  const slotSelect = new StringSelectMenuBuilder()
    .setCustomId(encodeStashId('ewslot', item.id, donorId ?? ''))
    .setPlaceholder('Slot (deselect to clear)\u2026')
    .setMinValues(0)
    .setMaxValues(1)
    .addOptions(
      STASH_SLOTS.map((s) => ({ label: s.label, value: s.value, default: s.value === slot }))
    );

  const donorSelect = new UserSelectMenuBuilder()
    .setCustomId(encodeStashId('ewdon', item.id, slot ?? ''))
    .setPlaceholder('Change donor (leave to keep)\u2026')
    .setMinValues(0)
    .setMaxValues(1);
  if (donorId) donorSelect.setDefaultUsers([donorId]);

  const next = new ButtonBuilder()
    .setCustomId(encodeStashId('ewnx', item.id, slot ?? '', donorId ?? ''))
    .setLabel('Next: edit details')
    .setStyle(ButtonStyle.Primary);

  return { embeds: [embed], components: [row(slotSelect), row(donorSelect), row(next)] };
}

/**
 * Build the Edit details modal opened by the edit wizard's Next button. Slot and
 * donor ride the submit id (`edits|<id>|<slot>|<donorId>`); this modal prefills
 * the free text — name (required), Wowhead id, notes — from the current item, and
 * an emptied optional field CLEARS that column (per store.editItem's contract).
 * Quantity is intentionally absent (editItem never touches stock counts).
 *
 * @param {object} item the item being edited (for prefill)
 * @param {{ slot?: string|null, donorId?: string|null }} [state]
 * @returns {ModalBuilder}
 */
export function buildEditModal(item, { slot = null, donorId = null } = {}) {
  const input = (
    id,
    label,
    value,
    { style = TextInputStyle.Short, required = false, max } = {}
  ) => {
    const b = new TextInputBuilder().setCustomId(id).setLabel(label).setStyle(style);
    b.setRequired(required);
    if (max) b.setMaxLength(max);
    if (value) b.setValue(String(value));
    return new ActionRowBuilder().addComponents(b);
  };
  return new ModalBuilder()
    .setCustomId(encodeStashId('edits', item.id, slot ?? '', donorId ?? ''))
    .setTitle('Edit stash item')
    .addComponents(
      input('name', 'Item name', item.name, { required: true, max: 200 }),
      input(
        'wowhead',
        'Wowhead item id or URL \u2014 empty clears',
        normalizeWowheadId(item.wowheadId),
        {
          max: 200
        }
      ),
      input('notes', 'Notes \u2014 empty clears', item.notes, {
        style: TextInputStyle.Paragraph,
        max: 500
      })
    );
}
