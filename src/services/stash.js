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

/** One display line per item: name, remaining count, slot, and claimed marker. */
function itemLine(item) {
  const name = itemNameMarkup({ name: item.name, wowheadId: normalizeWowheadId(item.wowheadId) });
  const bits = [`${name} \u00d7${item.remaining}`];
  if (item.slot) bits.push(`(${item.slot})`);
  if (item.status === 'requested' || item.remaining < 1) bits.push('\u2014 _all claimed_');
  return `\u2022 ${bits.join(' ')}`;
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
    ? items.map(itemLine).join('\n')
    : 'The stash is empty right now. Check back after the next donation drop.';

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
        open.slice(0, SELECT_LIMIT).map((it) => {
          const opt = { label: truncate(it.name, 100), value: it.id };
          const desc = [it.slot, `\u00d7${it.remaining} left`].filter(Boolean).join(' \u00b7 ');
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
