import test from 'node:test';
import assert from 'node:assert/strict';
import { paginateFields } from '../../src/lib/paginate.js';
import { LIMITS } from '../../src/lib/embed.js';

/** Combined embed length exactly as Discord counts it against the 6000 cap. */
function embedLen(embed) {
  const d = embed.toJSON();
  let n = (d.title ?? '').length + (d.description ?? '').length + (d.footer?.text ?? '').length;
  for (const f of d.fields ?? []) n += f.name.length + f.value.length;
  return n;
}

test('single page: no counter appended, nothing split', () => {
  const pages = paginateFields({
    title: 'Gear',
    footer: 'meta',
    fields: [
      { name: 'A', value: 'x' },
      { name: 'B', value: 'y' }
    ]
  });
  assert.equal(pages.length, 1);
  const d = pages[0].toJSON();
  assert.equal(d.footer.text, 'meta'); // no "Page 1/1"
  assert.equal(d.fields.length, 2);
});

test('splits over the 6000 cap; every page stays under it and drops nothing', () => {
  const big = 'z'.repeat(1000);
  const fields = Array.from({ length: 20 }, (_, i) => ({ name: `S${i}`, value: big }));
  const pages = paginateFields({ title: 'Gear', footer: 'meta', fields });

  assert.ok(pages.length > 1, 'should span multiple pages');
  for (const p of pages) {
    assert.ok(embedLen(p) <= LIMITS.total, `page length ${embedLen(p)} must be <= ${LIMITS.total}`);
    assert.match(p.toJSON().footer.text, /· Page \d+\/\d+$/);
  }
  const totalFields = pages.reduce((n, p) => n + (p.toJSON().fields?.length ?? 0), 0);
  assert.equal(totalFields, 20, 'no field may be dropped across pages');
});

test('caps at 25 fields per page even when the fields are tiny', () => {
  const fields = Array.from({ length: 30 }, (_, i) => ({ name: `S${i}`, value: 'x' }));
  const pages = paginateFields({ title: 'T', fields });
  assert.ok(pages.length >= 2);
  for (const p of pages) assert.ok((p.toJSON().fields?.length ?? 0) <= LIMITS.fields);
});

test('guards an empty field value to the dash placeholder', () => {
  const pages = paginateFields({ title: 'T', fields: [{ name: 'A', value: '' }] });
  assert.equal(pages[0].toJSON().fields[0].value, '\u2014');
});
