import test from 'node:test';
import assert from 'node:assert/strict';
import { EmbedBuilder } from 'discord.js';
import { field, addFieldsWithinLimits, LIMITS } from '../../src/lib/embed.js';

// Sum an embed the way Discord counts toward its 6000 total: title + description
// + footer text + every field name/value.
function totalSize(json) {
  let n = (json.title?.length ?? 0) + (json.description?.length ?? 0) + (json.footer?.text?.length ?? 0);
  for (const f of json.fields ?? []) n += f.name.length + f.value.length;
  return n;
}

const note = (dropped) => field('\u2026', `${dropped} more`);

test('addFieldsWithinLimits keeps every field when the embed fits', () => {
  const embed = new EmbedBuilder().setTitle('T');
  addFieldsWithinLimits(embed, [field('a', '1'), field('b', '2')], note);
  const e = embed.toJSON();
  assert.equal(e.fields.length, 2);
  assert.ok(!e.fields.some((f) => f.name === '\u2026'), 'no overflow note when all fit');
});

test('addFieldsWithinLimits never emits an over-6000 embed and adds a note', () => {
  const big = 'x'.repeat(1000);
  const fields = Array.from({ length: 12 }, (_, i) => field(`f${i}`, big)); // ~12k raw
  const embed = new EmbedBuilder().setTitle('Title').setDescription('desc');
  addFieldsWithinLimits(embed, fields, note);
  const e = embed.toJSON();
  assert.ok(totalSize(e) <= LIMITS.total, `total ${totalSize(e)} must be <= ${LIMITS.total}`);
  assert.equal(e.fields.at(-1).name, '\u2026', 'overflow note is appended');
  assert.ok(e.fields.length < fields.length, 'some fields were dropped');
});

test('addFieldsWithinLimits respects the 25-field cap, reserving a slot for the note', () => {
  const fields = Array.from({ length: 30 }, (_, i) => field(`n${i}`, 'v'));
  const embed = new EmbedBuilder().setTitle('T');
  addFieldsWithinLimits(embed, fields, note);
  const e = embed.toJSON();
  assert.equal(e.fields.length, LIMITS.fields, 'total fields stay at the 25 cap');
  assert.equal(e.fields.at(-1).name, '\u2026', 'last field is the overflow note');
});

test('addFieldsWithinLimits counts pre-set title/description/footer toward the budget', () => {
  const embed = new EmbedBuilder()
    .setTitle('T'.repeat(LIMITS.title))
    .setDescription('D'.repeat(LIMITS.description))
    .setFooter({ text: 'F'.repeat(200) });
  // Title(256)+desc(4096)+footer(200) = 4552 base; only ~1248 of field budget left.
  const fields = Array.from({ length: 5 }, (_, i) => field(`f${i}`, 'y'.repeat(500)));
  addFieldsWithinLimits(embed, fields, note);
  const e = embed.toJSON();
  assert.ok(totalSize(e) <= LIMITS.total, `total ${totalSize(e)} must be <= ${LIMITS.total}`);
  assert.equal(e.fields.at(-1).name, '\u2026');
});
