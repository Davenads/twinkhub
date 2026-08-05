import { MessageFlags } from 'discord.js';
import { getContentStore } from '../content/store.js';
import { resolveBracket } from '../content/bracket.js';
import { parseCustomId, bisFollowups, buildPicker } from '../services/panels.js';
import { renderBis } from '../services/bis.js';
import { renderClassHub } from '../services/classhub.js';
import { renderEnchant } from '../services/enchant.js';
import { renderConsumable } from '../services/consumable.js';
import { renderStatweights } from '../services/statweights.js';
import { renderSpellcoef } from '../services/spellcoef.js';
import { renderTalents } from '../services/talents.js';
import { renderPets } from '../services/pets.js';
import { renderXpRules } from '../services/xprules.js';
import { renderTierlist } from '../services/tierlist.js';
import { renderGuide } from '../services/guide.js';
import { renderGearPage } from '../services/gear.js';

// Component router for the persistent enduser panels (P4). Buttons/selects fire
// interactionCreate carrying a customId; this parses the `p1|action|arg` contract
// and dispatches to a handler that calls the SAME render service the equivalent
// slash command uses, replying ephemerally so many users share one public panel
// with zero collision. No render logic lives here — only wiring.

/** Ephemeral reply that never pings (mentions in embeds stay display-only). */
async function reply(interaction, payload) {
  await interaction.reply({ ...payload, flags: MessageFlags.Ephemeral, allowedMentions: { parse: [] } });
}

/** Edit the user's own ephemeral in place (the build dropdown's morph-in-view). */
async function update(interaction, payload) {
  await interaction.update({ components: [], ...payload, allowedMentions: { parse: [] } });
}

/** Stale/unknown control: point the user at an admin refresh instead of failing. */
async function outOfDate(interaction) {
  await interaction.reply({
    content: 'This panel is out of date \u2014 ask an admin to run `/panels refresh`.',
    flags: MessageFlags.Ephemeral
  });
}

/** Nav a paged `/gear` result: edit the public message in place to show page N. */
async function updateGearPage(interaction, ctx, [cls, slot, faction, priority, page]) {
  const un = (v) => (v && v !== '-' ? v : null);
  const payload = renderGearPage({
    ...ctx,
    className: un(cls),
    slot: un(slot),
    faction: un(faction),
    priority: un(priority),
    page: Number(page) || 0
  });
  // `components: []` clears stale nav if the (re-derived) result collapsed to one page.
  await interaction.update({ components: [], ...payload, allowedMentions: { parse: [] } });
}

/** BiS result + the class-carrying follow-up buttons (enchants, consumables, ...). */
async function replyBis(interaction, ctx, className) {
  if (!className) return outOfDate(interaction);
  const payload = renderBis({ ...ctx, className });
  const components = bisFollowups({ ...ctx, className });
  await reply(interaction, { ...payload, components });
}

/** Rows for a class hub / BiS view: build dropdown (if any) + follow-up buttons. */
function classControls(ctx, className, selectedId = null) {
  const picker = buildPicker({ ...ctx, className, selectedId });
  return [...(picker ? [picker] : []), ...bisFollowups({ ...ctx, className })];
}

/** Class overview hub: neutral landing with the build picker + class buttons. */
async function replyHub(interaction, ctx, className) {
  if (!className) return outOfDate(interaction);
  const payload = renderClassHub({ ...ctx, className });
  await reply(interaction, { ...payload, components: classControls(ctx, className) });
}

/** Build pick from the hub dropdown: rewrite the same ephemeral to that loadout. */
async function updateBuild(interaction, ctx, className) {
  const buildId = interaction.values?.[0];
  if (!className || !buildId) return outOfDate(interaction);
  const payload = renderBis({ ...ctx, className, build: buildId });
  await update(interaction, { ...payload, components: classControls(ctx, className, buildId) });
}

// action -> handler(interaction, ctx = { store, bracket }, args). Select menus
// carry their chosen value in interaction.values[0]; buttons carry args in the id.
const HANDLERS = {
  // Class select -> open that class's hub. `bis` is the legacy target (older
  // posted panels) that jumps straight to the default BiS; `hub` is current.
  pick: (i, ctx, [what]) =>
    what === 'hub' ? replyHub(i, ctx, i.values?.[0]) : what === 'bis' ? replyBis(i, ctx, i.values?.[0]) : outOfDate(i),
  bis: (i, ctx, [cls]) => replyBis(i, ctx, cls),
  // Build dropdown on a hub -> rewrite the ephemeral in place to that loadout.
  build: (i, ctx, [cls]) => updateBuild(i, ctx, cls),
  eslot: (i, ctx) => reply(i, renderEnchant({ ...ctx, slot: i.values?.[0] })),
  ench: (i, ctx, [cls]) => reply(i, renderEnchant({ ...ctx, className: cls })),
  cons: (i, ctx, [type]) => reply(i, renderConsumable({ ...ctx, type })),
  consc: (i, ctx, [cls]) => reply(i, renderConsumable({ ...ctx, className: cls })),
  sw: (i, ctx, [cls]) => reply(i, renderStatweights({ ...ctx, className: cls })),
  scoef: (i, ctx, [cls]) => reply(i, renderSpellcoef({ ...ctx, className: cls })),
  talents: (i, ctx, [cls]) => reply(i, renderTalents({ ...ctx, className: cls })),
  pets: (i, ctx) => reply(i, renderPets({ ...ctx })),
  xprules: (i, ctx) => reply(i, renderXpRules({ ...ctx })),
  tierlist: (i, ctx) => reply(i, renderTierlist({ ...ctx })),
  guide: (i, ctx) => reply(i, renderGuide({ ...ctx, slug: i.values?.[0] })),
  // Paged /gear nav — edits the public result in place rather than replying.
  gearpage: (i, ctx, args) => updateGearPage(i, ctx, args)
};

/**
 * True when a component interaction targets a panel control (current-version id).
 * Lets the interaction router skip foreign components cheaply.
 */
export function isPanelComponent(interaction) {
  return parseCustomId(interaction?.customId) !== null;
}

/**
 * Dispatch a button/select interaction to its panel handler. Parses the versioned
 * customId, resolves the store + guild bracket, and calls the matching render
 * service. Unknown/stale ids get the "out of date" hint.
 */
export async function handleComponent(interaction) {
  const parsed = parseCustomId(interaction.customId);
  if (!parsed) return outOfDate(interaction);
  const handler = HANDLERS[parsed.action];
  if (!handler) return outOfDate(interaction);
  const store = await getContentStore();
  const bracket = await resolveBracket(interaction);
  await handler(interaction, { store, bracket }, parsed.args);
}
