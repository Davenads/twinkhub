import { EmbedBuilder } from 'discord.js';

// Shared embed presentation helpers. Every render service formats through these
// so no service can emit a payload Discord rejects (over-long or empty fields),
// and so brand color / title-suffix / footer conventions stay identical across
// all 14 data commands and (later) the P4 panels.

// The brand gold used for every successful result embed.
export const EMBED_COLOR = 0xc8aa6e;
// A distinct muted red for degrade / "not found" / empty-state embeds so an
// empty result never reads like a normal one (C4).
export const DEGRADE_COLOR = 0x9b4a4a;

// Discord's hard limits.
export const LIMITS = {
  fieldName: 256,
  fieldValue: 1024,
  title: 256,
  description: 4096,
  fields: 25,
  total: 6000
};

/** Truncate `s` to `max` chars, appending an ellipsis when it would overflow. */
export function truncate(s, max) {
  const str = String(s ?? '');
  return str.length > max ? `${str.slice(0, max - 1)}\u2026` : str;
}

/**
 * Coerce any string into a safe Discord embed field **value**: never empty
 * (Discord 400s on empty values) and never longer than 1024 chars. Route every
 * `addFields({ value })` through this so no authored content can break a reply.
 */
export function fieldValue(s) {
  const str = String(s ?? '').trim();
  return str.length ? truncate(str, LIMITS.fieldValue) : '\u2014';
}

/** Safe field **name**: never empty, capped at 256. */
export function fieldName(s) {
  const str = String(s ?? '').trim();
  return str.length ? truncate(str, LIMITS.fieldName) : '\u2014';
}

/**
 * A `{ name, value }` field object with both sides guarded. Optional `inline`.
 * Use in place of raw object literals passed to `addFields`.
 */
export function field(name, value, inline = false) {
  const f = { name: fieldName(name), value: fieldValue(value) };
  if (inline) f.inline = true;
  return f;
}

/**
 * Pack an array of line strings into as many guarded fields as needed so none
 * exceeds the 1024-char value cap — instead of truncating and dropping lines.
 * The first field keeps `name`; continuations are suffixed `(cont.)`. Used where
 * one field concatenates many rows (e.g. `/spellcoef` groups a class's whole
 * effect-type list into a single field, which mage's direct-damage ranks overrun).
 *
 * @param {string} name field name for the first chunk
 * @param {string[]} lines already-formatted display lines
 * @param {string} [sep] joiner between lines
 * @returns {{ name: string, value: string }[]}
 */
export function fieldsFromLines(name, lines, sep = '\n') {
  const out = [];
  let buf = [];
  let len = 0;
  const flush = () => {
    if (!buf.length) return;
    out.push(field(out.length ? `${name} (cont.)` : name, buf.join(sep)));
    buf = [];
    len = 0;
  };
  for (const raw of lines) {
    const line = String(raw ?? '');
    const add = (buf.length ? sep.length : 0) + line.length;
    if (buf.length && len + add > LIMITS.fieldValue) flush();
    buf.push(line);
    len += add;
  }
  flush();
  return out;
}

/**
 * Append the bracket meta as a parenthetical suffix — the single standardized
 * title form (C3): `Base (Warsong Gulch 19)`. No-op when meta is absent.
 */
export function metaTitle(base, meta) {
  return meta ? `${base} (${meta.battleground} ${meta.levelCap})` : String(base);
}

/**
 * The standard footer text for a bracket, or `null` when no client patch is
 * known. Extra `·`-joined bits (page counters, unverified counts) can be
 * appended by the caller.
 */
export function metaFooter(meta, extra = []) {
  const bits = [...extra];
  if (meta?.gameVersion?.clientPatch) bits.push(`WoW Classic Era ${meta.gameVersion.clientPatch}`);
  return bits.length ? bits.join(' \u00b7 ') : null;
}

/**
 * A single degrade embed (distinct color) with a title and message. Every
 * service's "no data / not found / empty" branch should return this so empty
 * states are visually consistent and obviously not a normal result.
 */
export function degradeEmbed(title, message) {
  return new EmbedBuilder()
    .setColor(DEGRADE_COLOR)
    .setTitle(truncate(title, LIMITS.title))
    .setDescription(truncate(message, LIMITS.description));
}
