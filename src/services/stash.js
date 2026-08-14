import {
  EmbedBuilder,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  StringSelectMenuBuilder
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
    if (arr && arr.length) out.push({ label, items: arr.slice().sort(byName) });
  }
  if (ungrouped.length) out.push({ label: 'Ungrouped', items: ungrouped.slice().sort(byName) });
  return out;
}

/** Only items a requester can actually claim right now populate the dropdown. */
function claimable(items) {
  return items.filter((it) => it.status === 'available' && it.remaining > 0);
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
  if (open.length) {
    const select = new StringSelectMenuBuilder()
      .setCustomId(encodeStashId('req'))
      .setPlaceholder('Request an item\u2026')
      .addOptions(
        orderedOpen.slice(0, SELECT_LIMIT).map((it) => {
          const opt = { label: truncate(it.name, 100), value: it.id };
          const slotLabel = SLOT_LABEL.get(normalizeSlot(it.slot)) || it.slot;
          const desc = [slotLabel, `\u00d7${it.remaining} left`].filter(Boolean).join(' \u00b7 ');
          if (desc) opt.description = truncate(desc, 100);
          return opt;
        })
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
 * Build the Manager Console panel — a manager-only dashboard posted in a
 * restricted channel. Read-only for now (request/stock counts + a Refresh
 * button); the interactive approve/deny/sent selects are a later slice, so this
 * intentionally exposes no per-request controls yet.
 *
 * @param {{ items?: Array, pending?: Array, approved?: Array }} args
 * @returns {{ embeds: EmbedBuilder[], components: ActionRowBuilder[] }}
 */
export function buildManagerPanel({ items = [], pending = [], approved = [] } = {}) {
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
    .setFooter({ text: 'Act on requests with /stashadmin queue.' });

  const components = [
    row(
      new ButtonBuilder()
        .setCustomId(encodeStashId('mref'))
        .setLabel('Refresh')
        .setStyle(ButtonStyle.Secondary)
    )
  ];

  return { embeds: [embed], components };
}
