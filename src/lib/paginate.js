import { EmbedBuilder } from 'discord.js';
import { EMBED_COLOR, LIMITS, truncate, field as guardField } from './embed.js';

// Discord caps a single embed's *combined* length (title + description + every
// field name/value + footer) at 6000 — separate from the per-field 1024 cap the
// `field()` helper already enforces. High-volume list commands (`/gear` with no
// filter dumps every candidate item across ~16 slots) blow past 6000 in total
// even though each field is individually legal, so Discord 400s the whole reply
// (error 50035 MAX_EMBED_SIZE_EXCEEDED). Splitting into multiple embeds in one
// message does NOT help — the 6000 cap is per *message* across all embeds — so
// the fix is real pagination: one embed per page, navigated with buttons.

// Headroom under the hard 6000 cap: leaves room for the per-page "Page i/n"
// footer counter and any rounding, so an assembled page can never breach 6000.
const PAGE_RESERVE = 200;

/**
 * Split guarded embed fields into as many pages as needed so no page's combined
 * length exceeds Discord's per-message embed cap (and no page exceeds 25 fields).
 * Every page repeats the same title/description/footer; when there's more than
 * one page a `Page i/n` counter is appended to the footer. Field name/value are
 * routed through `field()` so neither can be empty or overrun 1024.
 *
 * @param {object} args
 * @param {string} args.title
 * @param {string} [args.description]
 * @param {string} [args.footer]        base footer text (counter appended per page)
 * @param {{name:string,value:string}[]} args.fields
 * @param {number} [args.color]
 * @param {number} [args.maxTotal]      per-page combined-length budget
 * @param {number} [args.maxFields]     per-page field-count cap
 * @returns {EmbedBuilder[]} one EmbedBuilder per page (always at least one)
 */
export function paginateFields({
  title = '',
  description = '',
  footer = '',
  fields = [],
  color = EMBED_COLOR,
  maxTotal = LIMITS.total - PAGE_RESERVE,
  maxFields = LIMITS.fields
}) {
  const safe = fields.map((f) => guardField(f.name, f.value));

  // Fixed per-page overhead that every page carries (counter reserved above).
  const baseLen = String(title).length + String(description).length + String(footer).length;

  const chunks = [];
  let cur = [];
  let len = baseLen;
  for (const f of safe) {
    const add = f.name.length + f.value.length;
    if (cur.length && (cur.length >= maxFields || len + add > maxTotal)) {
      chunks.push(cur);
      cur = [];
      len = baseLen;
    }
    cur.push(f);
    len += add;
  }
  chunks.push(cur); // always push the final (possibly empty) page

  const total = chunks.length;
  return chunks.map((fs, i) => {
    const embed = new EmbedBuilder().setColor(color).setTitle(truncate(title, LIMITS.title));
    if (description) embed.setDescription(truncate(description, LIMITS.description));
    if (fs.length) embed.addFields(fs);
    const foot = total > 1 ? [footer, `Page ${i + 1}/${total}`].filter(Boolean).join(' \u00b7 ') : footer;
    if (foot) embed.setFooter({ text: foot });
    return embed;
  });
}
