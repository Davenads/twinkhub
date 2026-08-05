import { MessageFlags } from 'discord.js';
import { getContentStore } from '../content/store.js';
import { resolveBracket } from '../content/bracket.js';
import { parseCustomId, bisFollowups, buildPicker, navRow } from '../services/panels.js';
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
// slash command uses. No render logic lives here — only wiring.
//
// Ephemeral discipline: a class pick opens ONE ephemeral, and every step within
// that flow (build pick, follow-up lookups, Back) edits the SAME message in place
// via `interaction.update()` — never a fresh reply — so a user's clicks don't
// stack ephemerals that bury the public panel. A Close button deletes the
// ephemeral outright. Only entry points that live on a *public* panel message
// (class pick, and the standalone enchant/consumable/reference lookups) open a
// new ephemeral, since updating would mutate the shared panel for everyone.

/** Ephemeral reply that never pings (mentions in embeds stay display-only). */
async function reply(interaction, payload) {
  await interaction.reply({ ...payload, flags: MessageFlags.Ephemeral, allowedMentions: { parse: [] } });
}

/** Edit the user's own ephemeral in place (the build dropdown's morph-in-view). */
async function update(interaction, payload) {
  await interaction.update({ components: [], ...payload, allowedMentions: { parse: [] } });
}

/** Close button: delete the clicker's ephemeral so it doesn't linger/pile up. */
async function closeEphemeral(interaction) {
  await interaction.deferUpdate();
  await interaction.deleteReply();
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

/** Gear/hub view controls: build dropdown (if any) + follow-ups + a Close button. */
function gearControls(ctx, className, selectedId = null) {
  const picker = buildPicker({ ...ctx, className, selectedId });
  return [
    ...(picker ? [picker] : []),
    ...bisFollowups({ ...ctx, className, build: selectedId }),
    navRow({})
  ];
}

/** Follow-up sub-view controls: the lateral follow-ups + a Back and Close row. */
function subControls(ctx, className, build) {
  return [...bisFollowups({ ...ctx, className, build }), navRow({ className, build, back: true })];
}

/** A single-shot lookup ephemeral (from a non-class panel): result + Close only. */
function withClose(payload) {
  return { ...payload, components: [navRow({})] };
}

/** Class overview hub: neutral landing with the build picker + class buttons. */
async function replyHub(interaction, ctx, className) {
  if (!className) return outOfDate(interaction);
  const payload = renderClassHub({ ...ctx, className });
  await reply(interaction, { ...payload, components: gearControls(ctx, className) });
}

/** Legacy `bis` entry (older posted panels): open the default BiS in a new ephemeral. */
async function replyBis(interaction, ctx, className) {
  if (!className) return outOfDate(interaction);
  const payload = renderBis({ ...ctx, className });
  await reply(interaction, { ...payload, components: gearControls(ctx, className) });
}

/** Build pick from the hub dropdown: rewrite the same ephemeral to that loadout. */
async function updateBuild(interaction, ctx, className) {
  const buildId = interaction.values?.[0];
  if (!className || !buildId) return outOfDate(interaction);
  const payload = renderBis({ ...ctx, className, build: buildId });
  await update(interaction, { ...payload, components: gearControls(ctx, className, buildId) });
}

/** Back from a follow-up: rebuild the gear view (with build) or the hub (without). */
async function updateBack(interaction, ctx, className, build) {
  if (!className) return outOfDate(interaction);
  const payload = build ? renderBis({ ...ctx, className, build }) : renderClassHub({ ...ctx, className });
  await update(interaction, { ...payload, components: gearControls(ctx, className, build ?? null) });
}

/** A class follow-up (enchants/consumables/...): morph the same ephemeral in place. */
async function updateFollowup(interaction, ctx, className, build, payload) {
  if (!className) return outOfDate(interaction);
  await update(interaction, { ...payload, components: subControls(ctx, className, build) });
}

// action -> handler(interaction, ctx = { store, bracket }, args). Select menus
// carry their chosen value in interaction.values[0]; buttons carry args in the id.
const HANDLERS = {
  // Class select -> open that class's hub. `bis` is the legacy target (older
  // posted panels) that jumps straight to the default BiS; `hub` is current.
  pick: (i, ctx, [what]) =>
    what === 'hub' ? replyHub(i, ctx, i.values?.[0]) : what === 'bis' ? replyBis(i, ctx, i.values?.[0]) : outOfDate(i),
  bis: (i, ctx, [cls]) => replyBis(i, ctx, cls),
  // Build dropdown / Back button on a class ephemeral -> rewrite it in place.
  build: (i, ctx, [cls]) => updateBuild(i, ctx, cls),
  back: (i, ctx, [cls, build]) => updateBack(i, ctx, cls, build),
  // Close button -> delete the ephemeral so it doesn't linger.
  close: (i) => closeEphemeral(i),
  // Class follow-ups -> morph the same class ephemeral in place (no stacking).
  ench: (i, ctx, [cls, build]) => updateFollowup(i, ctx, cls, build, renderEnchant({ ...ctx, className: cls })),
  consc: (i, ctx, [cls, build]) => updateFollowup(i, ctx, cls, build, renderConsumable({ ...ctx, className: cls })),
  sw: (i, ctx, [cls, build]) => updateFollowup(i, ctx, cls, build, renderStatweights({ ...ctx, className: cls })),
  scoef: (i, ctx, [cls, build]) => updateFollowup(i, ctx, cls, build, renderSpellcoef({ ...ctx, className: cls })),
  talents: (i, ctx, [cls, build]) => updateFollowup(i, ctx, cls, build, renderTalents({ ...ctx, className: cls })),
  pets: (i, ctx, [cls, build]) => updateFollowup(i, ctx, cls, build, renderPets({ ...ctx })),
  // Standalone lookups from the enchant/consumable/reference panels — each opens a
  // fresh ephemeral (their buttons live on public panels) with just a Close button.
  eslot: (i, ctx) => reply(i, withClose(renderEnchant({ ...ctx, slot: i.values?.[0] }))),
  cons: (i, ctx, [type]) => reply(i, withClose(renderConsumable({ ...ctx, type }))),
  xprules: (i, ctx) => reply(i, withClose(renderXpRules({ ...ctx }))),
  tierlist: (i, ctx) => reply(i, withClose(renderTierlist({ ...ctx }))),
  guide: (i, ctx) => reply(i, withClose(renderGuide({ ...ctx, slug: i.values?.[0] }))),
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
