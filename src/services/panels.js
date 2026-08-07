import {
  EmbedBuilder,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  StringSelectMenuBuilder
} from 'discord.js';
import { EMBED_COLOR, truncate, LIMITS } from '../lib/embed.js';
import { capitalize } from '../lib/text.js';
import {
  listClassNames,
  listEnchantSlots,
  listConsumableTypes,
  listGuides,
  listStatweightClasses,
  listSpellcoefClasses,
  listTalentClasses,
  buildsForClass,
  classIconComponent,
  consumableIconComponent
} from '../content/store.js';

// Persistent interactive enduser panels (P4, plans/08-enduser-panels.md). This
// module is the *panel layer*: it builds the public panel messages (embed +
// button/select controls) and encodes/parses the versioned `customId` contract
// the component router dispatches on. It never renders command results itself —
// the component handler calls the same render services the slash commands use.

// Version prefix on every panel customId. Bumping it (p1 -> p2) makes the router
// treat all previously-posted buttons as stale so it can point users at
// `/panels refresh` instead of silently no-op'ing.
export const PANEL_VERSION = 'p1';
const SEP = '|';

// Ordered set of panel messages a full post produces. Each key also names the
// stored message id in guild config so refresh can edit the right message.
export const PANEL_KEYS = ['classBuilds', 'enchants', 'consumables', 'reference'];

// Friendly button labels for consumable types (mirrors the /consumable choices).
const CONSUMABLE_LABELS = {
  potion: 'Potions',
  poison: 'Poisons',
  elixir: 'Elixirs',
  scroll: 'Scrolls',
  food: 'Food',
  bandage: 'Bandages',
  'weapon-buff': 'Weapon Buffs',
  explosive: 'Explosives',
  worldbuff: 'World Buffs',
  utility: 'Utility'
};

function consumableLabel(type) {
  return CONSUMABLE_LABELS[type] ?? String(type).split('-').map(capitalize).join(' ');
}

// Representative registry consumable id per type, used to put a recognisable icon
// on each consumables-panel button (and the BiS Consumables follow-up). The id
// only needs to exist in the emoji registry; a missing/unfilled one degrades to a
// text-only button. Types without a good stand-in are simply omitted.
const CONSUMABLE_BUTTON_EMOJI = {
  potion: 'healing-potion',
  elixir: 'elixir-lesser-agility',
  scroll: 'scroll-of-agility',
  food: 'rumsey-rum-black-label',
  bandage: 'heavy-runecloth-bandage',
  'weapon-buff': 'heavy-sharpening-stone',
  explosive: 'heavy-dynamite',
  utility: 'magic-dust'
};

/**
 * Encode a panel component id: `p1|action|arg|arg...`. Args must be short slugs
 * (class/slot/type/guide keys), never free text, so the id stays under Discord's
 * 100-char customId cap.
 */
export function encodeCustomId(action, ...args) {
  return [PANEL_VERSION, action, ...args].join(SEP);
}

/**
 * Parse a component customId. Returns `{ action, args }` for a current (`p1`)
 * panel control, or null for anything else — a foreign component or a stale id
 * from a previous version — so the router can show the "out of date" hint.
 */
export function parseCustomId(customId) {
  if (typeof customId !== 'string') return null;
  const parts = customId.split(SEP);
  if (parts[0] !== PANEL_VERSION || parts.length < 2 || !parts[1]) return null;
  return { action: parts[1], args: parts.slice(2) };
}

const row = (...components) => new ActionRowBuilder().addComponents(...components);

function chunk(arr, size) {
  const out = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out;
}

function panelEmbed(title, description) {
  return new EmbedBuilder()
    .setColor(EMBED_COLOR)
    .setTitle(truncate(title, LIMITS.title))
    .setDescription(truncate(description, LIMITS.description));
}

// --- Panel builders. Each returns { embeds, components } or null when the
// bracket has no data to back that panel (so it's simply not posted). ---

function buildClassBuildsPanel({ store, bracket }) {
  const classes = listClassNames(store, bracket);
  if (!classes.length) return null;
  const select = new StringSelectMenuBuilder()
    .setCustomId(encodeCustomId('pick', 'hub'))
    .setPlaceholder('Pick a class\u2026')
    .addOptions(
      classes.slice(0, 25).map((c) => {
        const opt = { label: capitalize(c), value: c };
        // Per-class icon (application emoji). Omitted when the id is unfilled so
        // the option still renders — the registry ids can be added later.
        const emoji = classIconComponent(store, c);
        if (emoji) opt.emoji = emoji;
        return opt;
      })
    );
  return {
    embeds: [
      panelEmbed(
        'Class Builds & BiS',
        'Pick a class to open its overview \u2014 then choose a role/faction build to see its best-in-slot gear. Your result is private (only you see it) and carries buttons for that class\u2019s enchants, consumables, and more.'
      )
    ],
    components: [row(select)]
  };
}

function buildEnchantsPanel({ store, bracket }) {
  const slots = listEnchantSlots(store, bracket);
  if (!slots.length) return null;
  const select = new StringSelectMenuBuilder()
    .setCustomId(encodeCustomId('eslot'))
    .setPlaceholder('Pick a gear slot\u2026')
    .addOptions(slots.slice(0, 25).map((s) => ({ label: capitalize(s), value: s })));
  return {
    embeds: [
      panelEmbed(
        'Enchants',
        'Pick a slot to see its enchants, with the no-level-requirement ones flagged.'
      )
    ],
    components: [row(select)]
  };
}

function buildConsumablesPanel({ store, bracket }) {
  const types = listConsumableTypes(store, bracket);
  if (!types.length) return null;
  const buttons = types.slice(0, 25).map((t) => {
    const button = new ButtonBuilder()
      .setCustomId(encodeCustomId('cons', t))
      .setLabel(consumableLabel(t))
      .setStyle(ButtonStyle.Secondary);
    // Representative icon per type; degrades to text-only when unmapped/unfilled.
    const emoji = consumableIconComponent(store, CONSUMABLE_BUTTON_EMOJI[t]);
    if (emoji) button.setEmoji(emoji);
    return button;
  });
  // 5 buttons per row, up to 5 rows.
  const components = chunk(buttons, 5)
    .slice(0, 5)
    .map((group) => row(...group));
  return {
    embeds: [
      panelEmbed(
        'Consumables',
        'Pick a category to see the recommended consumables for the bracket.'
      )
    ],
    components
  };
}

function buildReferencePanel({ store, bracket }) {
  const components = [
    row(
      new ButtonBuilder()
        .setCustomId(encodeCustomId('xprules'))
        .setLabel('XP Rules')
        .setStyle(ButtonStyle.Primary),
      new ButtonBuilder()
        .setCustomId(encodeCustomId('tierlist'))
        .setLabel('Tier List')
        .setStyle(ButtonStyle.Primary)
    )
  ];
  const guides = listGuides(store, bracket);
  if (guides.length) {
    const select = new StringSelectMenuBuilder()
      .setCustomId(encodeCustomId('guide'))
      .setPlaceholder('Open a guide\u2026')
      .addOptions(
        guides.slice(0, 25).map((g) => {
          const opt = { label: truncate(g.title, 100), value: g.slug };
          if (g.summary) opt.description = truncate(g.summary, 100);
          return opt;
        })
      );
    components.push(row(select));
  }
  return {
    embeds: [
      panelEmbed(
        'Reference',
        'XP-management rules, the class tier list, and curated guides for the bracket.'
      )
    ],
    components
  };
}

/**
 * Build the full ordered panel set for a bracket. Panels with no backing content
 * are omitted. Each item is `{ key, embeds, components }` — `key` is the config
 * message-id key (see PANEL_KEYS).
 *
 * @param {{ store: object, bracket: string }} args
 * @returns {{ key: string, embeds: object[], components: object[] }[]}
 */
export function buildPanels({ store, bracket }) {
  const out = [];
  const add = (key, panel) => {
    if (panel) out.push({ key, ...panel });
  };
  add('classBuilds', buildClassBuildsPanel({ store, bracket }));
  add('enchants', buildEnchantsPanel({ store, bracket }));
  add('consumables', buildConsumablesPanel({ store, bracket }));
  add('reference', buildReferencePanel({ store, bracket }));
  return out;
}

/**
 * The build-selection dropdown for a class's hub (role x faction picker). One
 * option per authored build, value = the build id (which `renderBis` matches
 * directly, so no separate faction arg is needed). The faction suffix
 * (`Offense \u2014 Horde`) is appended only when a role name exists on more than one
 * faction, so single-faction classes (paladin/shaman) and roles unique to one
 * side stay clean. `selectedId` marks the current pick so an in-place refresh
 * reflects state. Returns an ActionRow or null when the class has no builds.
 *
 * @param {{ store: object, bracket: string, className: string, selectedId?: string|null }} args
 * @returns {ActionRowBuilder|null}
 */
export function buildPicker({ store, bracket, className, selectedId = null }) {
  const cls = String(className ?? '').toLowerCase();
  const builds = buildsForClass(store, bracket, cls);
  if (!builds.length) return null;

  // Per role name, which factions offer it — drives the "where applicable" suffix.
  const factionsByRole = new Map();
  for (const b of builds) {
    const set = factionsByRole.get(b.name) ?? new Set();
    set.add(b.faction ?? 'both');
    factionsByRole.set(b.name, set);
  }

  const options = builds.slice(0, 25).map((b) => {
    const fac = b.faction && b.faction !== 'both' ? capitalize(b.faction) : null;
    const needsSuffix = (factionsByRole.get(b.name)?.size ?? 1) > 1 && fac;
    const label = needsSuffix ? `${b.name} \u2014 ${fac}` : b.name;
    const desc = fac ? `${capitalize(b.role)} \u00b7 ${fac}` : capitalize(b.role);
    const opt = { label: truncate(label, 100), value: b.id, description: truncate(desc, 100) };
    if (selectedId && b.id === selectedId) opt.default = true;
    return opt;
  });

  const select = new StringSelectMenuBuilder()
    .setCustomId(encodeCustomId('build', cls))
    .setPlaceholder('Pick a build\u2026')
    .addOptions(options);
  return row(select);
}

/**
 * Follow-up controls appended to a class ephemeral (hub or BiS result). Each
 * button carries the class in its customId so the next click needs no re-pick,
 * and — when a build is active — the build id too, so the router can rebuild the
 * exact loadout when the user hits Back. Stat Weights / Spell Scaling appear only
 * for classes that have that data; Pets only for Hunter.
 *
 * @param {{ store: object, bracket: string, className: string, build?: string|null }} args
 * @returns {ActionRowBuilder[]}
 */
export function bisFollowups({ store, bracket, className, build = null }) {
  const cls = String(className ?? '').toLowerCase();
  // Thread the active build id into every follow-up id (omitted when none is
  // selected, e.g. the neutral hub), keeping ids as short slugs under the cap.
  const fid = (action) => encodeCustomId(action, cls, ...(build ? [build] : []));
  const consBtn = new ButtonBuilder()
    .setCustomId(fid('consc'))
    .setLabel('Consumables')
    .setStyle(ButtonStyle.Secondary);
  const consEmoji = consumableIconComponent(store, CONSUMABLE_BUTTON_EMOJI.potion);
  if (consEmoji) consBtn.setEmoji(consEmoji);
  const buttons = [
    new ButtonBuilder()
      .setCustomId(fid('ench'))
      .setLabel('Enchants')
      .setStyle(ButtonStyle.Secondary),
    consBtn
  ];
  if (listStatweightClasses(store, bracket).includes(cls)) {
    buttons.push(
      new ButtonBuilder()
        .setCustomId(fid('sw'))
        .setLabel('Stat Weights')
        .setStyle(ButtonStyle.Secondary)
    );
  }
  if (listSpellcoefClasses(store, bracket).includes(cls)) {
    buttons.push(
      new ButtonBuilder()
        .setCustomId(fid('scoef'))
        .setLabel('Spell Scaling')
        .setStyle(ButtonStyle.Secondary)
    );
  }
  if (listTalentClasses(store, bracket).includes(cls)) {
    buttons.push(
      new ButtonBuilder()
        .setCustomId(fid('talents'))
        .setLabel('Talents')
        .setStyle(ButtonStyle.Secondary)
    );
  }
  if (cls === 'hunter') {
    buttons.push(
      new ButtonBuilder().setCustomId(fid('pets')).setLabel('Pets').setStyle(ButtonStyle.Secondary)
    );
  }
  // Up to 6 followups now (casters gain Talents) — split across rows of 5 so a
  // full set never exceeds Discord's 5-buttons-per-row cap.
  return chunk(buttons, 5).map((group) => row(...group));
}

/**
 * Navigation row for an ephemeral panel view. A Close button (deletes the
 * clicker's ephemeral so panels don't pile up in the channel) is always present;
 * an optional Back button precedes it on follow-up sub-views, carrying the class
 * and active build so Back restores the exact gear view (or the neutral overview
 * when no build is set). The gear view itself and single-shot lookup ephemerals
 * pass `{}` for a Close-only row.
 *
 * @param {{ className?: string|null, build?: string|null, back?: boolean }} args
 * @returns {ActionRowBuilder}
 */
export function navRow({ className = null, build = null, back = false } = {}) {
  const buttons = [];
  if (back && className) {
    buttons.push(
      new ButtonBuilder()
        .setCustomId(encodeCustomId('back', className, ...(build ? [build] : [])))
        .setLabel('Back')
        .setStyle(ButtonStyle.Secondary)
    );
  }
  buttons.push(
    new ButtonBuilder()
      .setCustomId(encodeCustomId('close'))
      .setLabel('Close')
      .setStyle(ButtonStyle.Secondary)
  );
  return row(...buttons);
}
