import test from 'node:test';
import assert from 'node:assert/strict';
import {
  STASH_VERSION,
  encodeStashId,
  parseStashCustomId,
  buildStashPanel,
  normalizeWowheadId
} from '../../src/services/stash.js';

// Build N item stand-ins. Each defaults to a claimable available unit. `id` is
// prefixed to a real item id; destructure it out so the spread can't clobber it.
function item(over = {}) {
  const { id, ...rest } = over;
  return {
    id: `itm_${id ?? Math.random().toString(16).slice(2, 10)}`,
    name: 'Item',
    slot: null,
    remaining: 1,
    status: 'available',
    ...rest
  };
}

// The select row (or null) and its options, from a panel's components.
function requestSelect(panel) {
  for (const row of panel.components) {
    const c = row.toJSON().components[0];
    if (c.custom_id === encodeStashId('req')) return c;
  }
  return null;
}

function buttonIds(panel) {
  return panel.components.flatMap((row) => row.toJSON().components.map((c) => c.custom_id));
}

test('encodeStashId / parseStashCustomId round-trip a versioned id', () => {
  const id = encodeStashId('req');
  assert.equal(id, `${STASH_VERSION}|req`);
  assert.deepEqual(parseStashCustomId(id), { action: 'req', args: [] });
  assert.deepEqual(parseStashCustomId(encodeStashId('mine', 'x')), { action: 'mine', args: ['x'] });
});

test('parseStashCustomId rejects content-panel, foreign, and malformed ids', () => {
  assert.equal(parseStashCustomId('p1|cons|potion'), null, 'content panel id is not ours');
  assert.equal(parseStashCustomId('s2|req'), null, 'future version');
  assert.equal(parseStashCustomId('s1'), null, 'no action');
  assert.equal(parseStashCustomId('s1|'), null, 'empty action');
  assert.equal(parseStashCustomId(''), null, 'empty string');
  assert.equal(parseStashCustomId(undefined), null, 'non-string');
});

test('buildStashPanel: empty inventory shows a degrade embed and no request select', () => {
  const panel = buildStashPanel({ items: [] });
  assert.equal(requestSelect(panel), null, 'no request select when nothing is claimable');
  // My Requests + Refresh buttons are always present.
  const ids = buttonIds(panel);
  assert.ok(ids.includes(encodeStashId('mine')), 'My Requests button present');
  assert.ok(ids.includes(encodeStashId('refresh')), 'Refresh button present');
});

test('buildStashPanel: only available, in-stock items populate the request select', () => {
  const items = [
    item({ id: 'a', name: 'Alpha', remaining: 2, status: 'available' }),
    item({ id: 'b', name: 'Beta', remaining: 0, status: 'given' }), // out of stock
    item({ id: 'c', name: 'Gamma', remaining: 1, status: 'requested' }) // all claimed
  ];
  const select = requestSelect(buildStashPanel({ items }));
  assert.ok(select, 'a request select exists');
  const values = select.options.map((o) => o.value);
  assert.deepEqual(values, ['itm_a'], 'only the claimable item is offered');
});

test('buildStashPanel: caps the request select at 25 options', () => {
  const items = Array.from({ length: 40 }, (_, i) =>
    item({ id: `i${i}`, name: `Item ${i}`, remaining: 1, status: 'available' })
  );
  const select = requestSelect(buildStashPanel({ items }));
  assert.equal(select.options.length, 25, 'select is capped at Discord max of 25');
});

test('buildStashPanel: default (no args) is safe and renders the empty state', () => {
  const panel = buildStashPanel();
  assert.equal(requestSelect(panel), null);
  assert.ok(panel.embeds.length === 1, 'one embed');
});

// Description helper: the panel's single embed description string.
function description(panel) {
  return panel.embeds[0].data.description;
}

test('normalizeWowheadId: bare id, Wowhead URL, or null; junk yields null', () => {
  assert.equal(normalizeWowheadId('12977'), '12977', 'bare id');
  assert.equal(normalizeWowheadId('  12977  '), '12977', 'trims whitespace');
  assert.equal(
    normalizeWowheadId('https://www.wowhead.com/classic/item=12977/magefist-gloves'),
    '12977',
    'extracts item id from a Classic URL'
  );
  assert.equal(normalizeWowheadId(12977), '12977', 'coerces a number');
  assert.equal(normalizeWowheadId(null), null, 'null passes through');
  assert.equal(normalizeWowheadId(undefined), null, 'undefined passes through');
  assert.equal(normalizeWowheadId('magefist'), null, 'a bare name is not an id');
  assert.equal(normalizeWowheadId(''), null, 'empty string is not an id');
});

test('buildStashPanel: a numeric wowheadId links the item name to Wowhead', () => {
  const desc = description(
    buildStashPanel({ items: [item({ name: 'Magefist Gloves', wowheadId: '12977' })] })
  );
  assert.ok(
    desc.includes('**[Magefist Gloves](https://www.wowhead.com/classic/item=12977)**'),
    'name is a masked Wowhead link'
  );
});

test('buildStashPanel: no wowheadId renders a plain bold name (no link)', () => {
  const desc = description(buildStashPanel({ items: [item({ name: 'Mystery Item' })] }));
  assert.ok(desc.includes('**Mystery Item**'), 'plain bold name');
  assert.ok(!desc.includes(']('), 'no masked link emitted');
});

test('buildStashPanel: a non-numeric wowheadId degrades to plain (never a broken link)', () => {
  const desc = description(
    buildStashPanel({ items: [item({ name: 'Junky', wowheadId: 'not-an-id' })] })
  );
  assert.ok(desc.includes('**Junky**'), 'plain bold name');
  assert.ok(!desc.includes('wowhead.com'), 'no link built from junk');
});
