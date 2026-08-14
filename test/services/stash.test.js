import test from 'node:test';
import assert from 'node:assert/strict';
import {
  STASH_VERSION,
  encodeStashId,
  parseStashCustomId,
  buildStashPanel,
  buildManagerPanel,
  buildRequestAction,
  buildDenyConfirm,
  buildWithdrawConfirm,
  normalizeWowheadId,
  normalizeSlot,
  STASH_SLOTS
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

// The select row (or null) whose custom_id matches the given action.
function selectByAction(panel, action) {
  for (const row of panel.components) {
    const c = row.toJSON().components[0];
    if (c.custom_id === encodeStashId(action)) return c;
  }
  return null;
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

test('STASH_SLOTS: well-formed choice list within Discord limits', () => {
  assert.ok(STASH_SLOTS.length > 0 && STASH_SLOTS.length <= 25, 'within the 25-choice cap');
  const values = STASH_SLOTS.map((s) => s.value);
  assert.equal(new Set(values).size, values.length, 'values are unique');
  for (const s of STASH_SLOTS) {
    assert.equal(typeof s.value, 'string');
    assert.ok(s.value.length > 0 && s.value.length <= 100, 'value length in range');
    assert.equal(typeof s.label, 'string');
    assert.ok(s.label.length > 0 && s.label.length <= 100, 'label length in range');
  }
  assert.ok(values.includes('shield') && values.includes('ranged'), 'shield + ranged present');
});

test('normalizeSlot: canonical passes, legacy synonyms fold, unknown/empty null', () => {
  assert.equal(normalizeSlot('hands'), 'hands', 'canonical value passes through');
  assert.equal(normalizeSlot('HANDS'), 'hands', 'case-insensitive');
  assert.equal(normalizeSlot('  feet  '), 'feet', 'trims whitespace');
  assert.equal(normalizeSlot('gloves'), 'hands', 'legacy synonym folds');
  assert.equal(normalizeSlot('boots'), 'feet', 'legacy synonym folds');
  assert.equal(normalizeSlot('belt'), 'waist', 'legacy synonym folds');
  assert.equal(normalizeSlot('cloak'), 'back', 'legacy synonym folds');
  assert.equal(normalizeSlot('mainhand'), 'weapon', 'legacy synonym folds');
  assert.equal(normalizeSlot('mystery'), null, 'unknown free text is ungrouped');
  assert.equal(normalizeSlot(''), null, 'empty is ungrouped');
  assert.equal(normalizeSlot(null), null, 'null is ungrouped');
});

test('buildStashPanel: items group under slot subheaders in paper-doll order', () => {
  const items = [
    item({ id: 'a', name: 'Boots', slot: 'feet' }),
    item({ id: 'b', name: 'Helm', slot: 'head' }),
    item({ id: 'c', name: 'Cape', slot: 'cloak' }) // legacy synonym -> back
  ];
  const desc = description(buildStashPanel({ items }));
  assert.ok(desc.includes('**Head**'), 'head subheader present');
  assert.ok(desc.includes('**Back (Cloak)**'), 'back subheader present (via synonym)');
  assert.ok(desc.includes('**Feet**'), 'feet subheader present');
  // Head precedes Back precedes Feet in paper-doll order.
  assert.ok(desc.indexOf('**Head**') < desc.indexOf('**Back (Cloak)**'), 'head before back');
  assert.ok(desc.indexOf('**Back (Cloak)**') < desc.indexOf('**Feet**'), 'back before feet');
});

test('buildStashPanel: slotless items land in a trailing Ungrouped section', () => {
  const items = [
    item({ id: 'a', name: 'Helm', slot: 'head' }),
    item({ id: 'b', name: 'Potion' }) // no slot
  ];
  const desc = description(buildStashPanel({ items }));
  assert.ok(desc.includes('**Ungrouped**'), 'ungrouped subheader present');
  assert.ok(desc.indexOf('**Head**') < desc.indexOf('**Ungrouped**'), 'ungrouped is last');
});

test('buildStashPanel: items sort by name within a slot group', () => {
  const items = [
    item({ id: 'a', name: 'Zephyr Cap', slot: 'head' }),
    item({ id: 'b', name: 'Aegis Helm', slot: 'head' })
  ];
  const desc = description(buildStashPanel({ items }));
  assert.ok(desc.indexOf('Aegis Helm') < desc.indexOf('Zephyr Cap'), 'alphabetical within group');
});

test('buildStashPanel: request select order matches the grouped display', () => {
  const items = [
    item({ id: 'a', name: 'Potion' }), // ungrouped -> last
    item({ id: 'b', name: 'Helm', slot: 'head' }), // first
    item({ id: 'c', name: 'Boots', slot: 'feet' }) // middle
  ];
  const values = requestSelect(buildStashPanel({ items })).options.map((o) => o.value);
  assert.deepEqual(values, ['itm_b', 'itm_c', 'itm_a'], 'head, feet, then ungrouped');
});

test('buildManagerPanel: renders request + stock counts and a Refresh button', () => {
  const panel = buildManagerPanel({
    items: [
      item({ id: 'a', remaining: 2, status: 'available' }),
      item({ id: 'b', remaining: 1, status: 'available' }),
      item({ id: 'c', remaining: 0, status: 'given' }) // out of stock, not counted
    ],
    pending: [{ id: 'r1' }, { id: 'r2' }],
    approved: [{ id: 'r3' }]
  });
  const desc = description(panel);
  assert.ok(desc.includes('**Pending** (awaiting approval): **2**'), 'pending count');
  assert.ok(desc.includes('**Approved** (awaiting hand-off): **1**'), 'approved count');
  assert.ok(desc.includes('**Available items**: **2** (3 units)'), 'stock counts');
  const ids = buttonIds(panel);
  assert.ok(ids.includes(encodeStashId('mref')), 'manager Refresh button present');
});

test('buildManagerPanel: default (no args) renders zeroed counts safely', () => {
  const desc = description(buildManagerPanel());
  assert.ok(desc.includes('**Pending** (awaiting approval): **0**'), 'zero pending');
  assert.ok(desc.includes('**Available items**: **0** (0 units)'), 'zero stock, plural unit');
});

test('buildManagerPanel: no open requests omits both console selects', () => {
  const panel = buildManagerPanel({ items: [item({ id: 'a' })] });
  assert.equal(selectByAction(panel, 'mq'), null, 'no pending select');
  assert.equal(selectByAction(panel, 'maq'), null, 'no approved select');
  assert.ok(buttonIds(panel).includes(encodeStashId('mref')), 'Refresh still present');
});

test('buildManagerPanel: pending/approved selects label by item and value by request id', () => {
  const panel = buildManagerPanel({
    items: [item({ id: 'a' })],
    pending: [{ id: 'r1', itemId: 'itm_a', userId: 'u1', status: 'pending' }],
    approved: [{ id: 'r2', itemId: 'itm_a', userId: 'u2', status: 'approved' }],
    names: { itm_a: 'Alpha' }
  });
  const mq = selectByAction(panel, 'mq');
  const maq = selectByAction(panel, 'maq');
  assert.ok(mq, 'pending select present');
  assert.ok(maq, 'approved select present');
  assert.equal(mq.options[0].label, 'Alpha', 'pending option labelled by item name');
  assert.equal(mq.options[0].value, 'r1', 'pending option value is the request id');
  assert.equal(maq.options[0].value, 'r2', 'approved option value is the request id');
});

test('buildManagerPanel: caps each console select at 25 options', () => {
  const pending = Array.from({ length: 40 }, (_, i) => ({
    id: `r${i}`,
    itemId: 'itm_a',
    userId: 'u',
    status: 'pending'
  }));
  const mq = selectByAction(buildManagerPanel({ pending }), 'mq');
  assert.equal(mq.options.length, 25, 'select capped at Discord max of 25');
});

test('buildRequestAction: a pending request offers Approve + Deny', () => {
  const panel = buildRequestAction({
    req: { id: 'r1', itemId: 'itm_a', userId: 'u1', status: 'pending' },
    itemName: 'Alpha'
  });
  const ids = buttonIds(panel);
  assert.ok(ids.includes(encodeStashId('aprv', 'r1')), 'Approve carries the request id');
  assert.ok(ids.includes(encodeStashId('deny', 'r1')), 'Deny carries the request id');
  assert.ok(!ids.includes(encodeStashId('sent', 'r1')), 'no Mark Sent while pending');
});

test('buildRequestAction: an approved request offers only Mark Sent', () => {
  const panel = buildRequestAction({
    req: { id: 'r2', itemId: 'itm_a', userId: 'u2', status: 'approved' },
    itemName: 'Alpha'
  });
  const ids = buttonIds(panel);
  assert.deepEqual(ids, [encodeStashId('sent', 'r2')], 'only Mark Sent');
});

test('buildRequestAction: a null itemName falls back to the raw item id', () => {
  const desc = description(
    buildRequestAction({ req: { id: 'r1', itemId: 'itm_a', userId: 'u1', status: 'pending' } })
  );
  assert.ok(desc.includes('`itm_a`'), 'raw item id shown when name is unknown');
});

test('buildDenyConfirm: two-click confirm carries the request id on both buttons', () => {
  const panel = buildDenyConfirm({
    req: { id: 'r1', itemId: 'itm_a', userId: 'u1', status: 'pending' },
    itemName: 'Alpha'
  });
  const ids = buttonIds(panel);
  assert.ok(ids.includes(encodeStashId('denyc', 'r1')), 'Confirm deny routes denyc|r1');
  assert.ok(ids.includes(encodeStashId('dcxl', 'r1')), 'Cancel routes dcxl|r1');
});

test('buildManagerPanel: in-stock items add a Withdraw select, empty stock omits it', () => {
  const stocked = buildManagerPanel({ items: [item({ id: 'a', name: 'Alpha' })] });
  const mwd = selectByAction(stocked, 'mwd');
  assert.ok(mwd, 'withdraw select present with stock');
  assert.equal(mwd.options[0].value, 'itm_a', 'option value is the item id');
  const empty = buildManagerPanel({ items: [item({ id: 'b', status: 'given', remaining: 0 })] });
  assert.equal(selectByAction(empty, 'mwd'), null, 'no withdraw select when nothing in stock');
});

test('buildWithdrawConfirm: both buttons carry the item id; warns on open requests', () => {
  const panel = buildWithdrawConfirm({
    item: { id: 'itm_a', name: 'Alpha', remaining: 2 },
    openCount: 3
  });
  const ids = buttonIds(panel);
  assert.ok(ids.includes(encodeStashId('wdc', 'itm_a')), 'Confirm routes wdc|itm_a');
  assert.ok(ids.includes(encodeStashId('wdcx', 'itm_a')), 'Cancel routes wdcx|itm_a');
  assert.ok(description(panel).includes('3 open requests will be cancelled'), 'plural warning');
});

test('buildWithdrawConfirm: no open requests omits the cancellation warning', () => {
  const desc = description(
    buildWithdrawConfirm({ item: { id: 'itm_a', name: 'Alpha', remaining: 1 } })
  );
  assert.ok(!desc.includes('will be cancelled'), 'no warning when nothing is open');
});
