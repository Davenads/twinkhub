import test from 'node:test';
import assert from 'node:assert/strict';
import {
  STASH_VERSION,
  encodeStashId,
  parseStashCustomId,
  buildStashPanel,
  buildSlotRequestPrompt,
  buildManageSlotPrompt,
  buildManagerPanel,
  buildRequestAction,
  buildDenyConfirm,
  buildWithdrawConfirm,
  buildAddWizard,
  buildAddModal,
  buildItemAction,
  buildEditWizard,
  buildEditModal,
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

test('buildStashPanel: 25 or fewer claimable items keep the flat request select', () => {
  const items = Array.from({ length: 25 }, (_, i) =>
    item({ id: `i${i}`, name: `Item ${i}`, slot: 'head', remaining: 1, status: 'available' })
  );
  const panel = buildStashPanel({ items });
  assert.ok(requestSelect(panel), 'flat req select present at the 25-item boundary');
  assert.equal(selectByAction(panel, 'reqslot'), null, 'no slot picker while it still fits');
});

test('buildStashPanel: more than 25 claimable items swap to a slot picker (no dropped items)', () => {
  const items = [
    ...Array.from({ length: 20 }, (_, i) => item({ id: `h${i}`, name: `Helm ${i}`, slot: 'head' })),
    ...Array.from({ length: 10 }, (_, i) => item({ id: `f${i}`, name: `Boot ${i}`, slot: 'feet' }))
  ];
  const panel = buildStashPanel({ items }); // 30 claimable > 25
  assert.equal(requestSelect(panel), null, 'flat req select is gone (would silently drop items)');
  const picker = selectByAction(panel, 'reqslot');
  assert.ok(picker, 'slot picker present');
  const byValue = Object.fromEntries(picker.options.map((o) => [o.value, o]));
  assert.deepEqual(Object.keys(byValue), ['head', 'feet'], 'a slot per populated group, in order');
  assert.ok(byValue.head.description.includes('20 available'), 'head count shown');
  assert.ok(byValue.feet.description.includes('10 available'), 'feet count shown');
});

test('buildSlotRequestPrompt: scopes a request select to one slot, capped at 25', () => {
  const items = [
    ...Array.from({ length: 30 }, (_, i) => item({ id: `h${i}`, name: `Helm ${i}`, slot: 'head' })),
    item({ id: 'f0', name: 'Boots', slot: 'feet' })
  ];
  const prompt = buildSlotRequestPrompt({ items, slot: 'head' });
  const select = prompt.components[0].toJSON().components[0];
  assert.equal(select.custom_id, encodeStashId('req'), 'the scoped select is a normal req select');
  assert.equal(select.options.length, 25, 'capped at Discord max of 25');
  assert.ok(
    select.options.every((o) => o.value.startsWith('itm_h')),
    'only the chosen slot is offered'
  );
  assert.ok(prompt.content.includes('Showing the first 25'), 'notes the overflow');
});

test('buildSlotRequestPrompt: ungrouped sentinel scopes to slotless items', () => {
  const items = [
    item({ id: 'a', name: 'Potion' }), // slotless
    item({ id: 'b', name: 'Helm', slot: 'head' })
  ];
  const select = buildSlotRequestPrompt({ items, slot: 'ungrouped' }).components[0].toJSON()
    .components[0];
  assert.deepEqual(
    select.options.map((o) => o.value),
    ['itm_a'],
    'only the slotless item is offered'
  );
});

test('buildSlotRequestPrompt: an empty slot yields a hint and no select', () => {
  const prompt = buildSlotRequestPrompt({ items: [item({ id: 'a', slot: 'head' })], slot: 'feet' });
  assert.deepEqual(prompt.components, [], 'no select when nothing is claimable in that slot');
  assert.ok(prompt.content.includes('No **Feet** items'), 'names the empty slot');
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

test('buildManagerPanel: manage-item select spans available/requested/given, active-first', () => {
  const panel = buildManagerPanel({
    items: [
      item({ id: 'a', name: 'Alpha' }),
      item({ id: 'b', name: 'Bravo', status: 'given', remaining: 0 }),
      item({ id: 'c', name: 'Charlie', status: 'requested' }),
      item({ id: 'd', name: 'Delta', status: 'withdrawn' })
    ]
  });
  const mitem = selectByAction(panel, 'mitem');
  assert.ok(mitem, 'manage-item select present');
  assert.deepEqual(
    mitem.options.map((o) => o.value),
    ['itm_a', 'itm_c', 'itm_b'],
    'available + requested before given; withdrawn excluded'
  );
  const empty = buildManagerPanel({ items: [item({ id: 'e', status: 'withdrawn' })] });
  assert.equal(selectByAction(empty, 'mitem'), null, 'no select when nothing is manageable');
});

test('buildManagerPanel: manage-item select flags rows missing a Wowhead link', () => {
  const panel = buildManagerPanel({
    items: [item({ id: 'a', name: 'Alpha' }), item({ id: 'b', name: 'Bravo', wowheadId: '12977' })]
  });
  const opts = selectByAction(panel, 'mitem').options;
  const desc = (v) => opts.find((o) => o.value === v).description;
  assert.ok(desc('itm_a').includes('no link'), 'linkless row flagged');
  assert.ok(!desc('itm_b').includes('no link'), 'linked row not flagged');
});

test('buildManagerPanel: 25 or fewer manageable items keep the flat manage select', () => {
  const items = Array.from({ length: 25 }, (_, i) =>
    item({ id: `m${i}`, name: `Item ${i}`, slot: 'head' })
  );
  const panel = buildManagerPanel({ items });
  assert.ok(selectByAction(panel, 'mitem'), 'flat mitem select present at the 25-item boundary');
  assert.equal(selectByAction(panel, 'mslot'), null, 'no slot picker while it still fits');
});

test('buildManagerPanel: more than 25 manageable items swap to a slot picker (no dropped items)', () => {
  const items = [
    ...Array.from({ length: 20 }, (_, i) => item({ id: `h${i}`, name: `Helm ${i}`, slot: 'head' })),
    ...Array.from({ length: 8 }, (_, i) =>
      item({ id: `f${i}`, name: `Boot ${i}`, slot: 'feet', status: 'given', remaining: 0 })
    )
  ];
  const panel = buildManagerPanel({ items }); // 28 manageable > 25
  assert.equal(
    selectByAction(panel, 'mitem'),
    null,
    'flat mitem select is gone (would drop items)'
  );
  const picker = selectByAction(panel, 'mslot');
  assert.ok(picker, 'slot picker present');
  const byValue = Object.fromEntries(picker.options.map((o) => [o.value, o]));
  assert.deepEqual(Object.keys(byValue), ['head', 'feet'], 'a slot per populated group, in order');
  assert.ok(byValue.head.description.includes('20 to manage'), 'head count shown');
  assert.ok(byValue.feet.description.includes('8 to manage'), 'given items still counted');
});

test('buildManageSlotPrompt: scopes a manage select to one slot, capped at 25', () => {
  const items = [
    ...Array.from({ length: 30 }, (_, i) => item({ id: `h${i}`, name: `Helm ${i}`, slot: 'head' })),
    item({ id: 'f0', name: 'Boots', slot: 'feet' })
  ];
  const prompt = buildManageSlotPrompt({ items, slot: 'head' });
  const select = prompt.components[0].toJSON().components[0];
  assert.equal(
    select.custom_id,
    encodeStashId('mitem'),
    'the scoped select is a normal mitem select'
  );
  assert.equal(select.options.length, 25, 'capped at Discord max of 25');
  assert.ok(
    select.options.every((o) => o.value.startsWith('itm_h')),
    'only the chosen slot is offered'
  );
  assert.ok(prompt.content.includes('Showing the first 25'), 'notes the overflow');
});

test('buildManageSlotPrompt: manager scope includes given/requested items, active-first', () => {
  const items = [
    item({ id: 'g', name: 'Given', slot: 'head', status: 'given', remaining: 0 }),
    item({ id: 'a', name: 'Avail', slot: 'head', status: 'available' }),
    item({ id: 'r', name: 'Req', slot: 'head', status: 'requested' }),
    item({ id: 'w', name: 'Gone', slot: 'head', status: 'withdrawn' })
  ];
  const select = buildManageSlotPrompt({ items, slot: 'head' }).components[0].toJSON()
    .components[0];
  assert.deepEqual(
    select.options.map((o) => o.value),
    ['itm_a', 'itm_r', 'itm_g'],
    'available + requested before given; withdrawn excluded'
  );
});

test('buildManageSlotPrompt: ungrouped sentinel scopes to slotless items', () => {
  const items = [
    item({ id: 'a', name: 'Potion' }), // slotless
    item({ id: 'b', name: 'Helm', slot: 'head' })
  ];
  const select = buildManageSlotPrompt({ items, slot: 'ungrouped' }).components[0].toJSON()
    .components[0];
  assert.deepEqual(
    select.options.map((o) => o.value),
    ['itm_a'],
    'only the slotless item is offered'
  );
});

test('buildManageSlotPrompt: an empty slot yields a hint and no select', () => {
  const prompt = buildManageSlotPrompt({ items: [item({ id: 'a', slot: 'head' })], slot: 'feet' });
  assert.deepEqual(prompt.components, [], 'no select when nothing is manageable in that slot');
  assert.ok(prompt.content.includes('No **Feet** items'), 'names the empty slot');
});

test('buildItemAction: offers Edit and Withdraw carrying the item id', () => {
  const ids = buttonIds(buildItemAction({ item: item({ id: 'a', name: 'Alpha' }) }));
  assert.ok(ids.includes(encodeStashId('medit', 'itm_a')), 'Edit routes medit|itm_a');
  assert.ok(ids.includes(encodeStashId('wdp', 'itm_a')), 'Withdraw routes wdp|itm_a');
});

test('buildItemAction: warns when the item lacks a Wowhead link, silent when it has one', () => {
  const missing = description(buildItemAction({ item: item({ id: 'a', name: 'Alpha' }) }));
  assert.ok(missing.includes('No Wowhead link'), 'linkless item warned');
  const linked = description(
    buildItemAction({ item: item({ id: 'b', name: 'Bravo', wowheadId: '12977' }) })
  );
  assert.ok(!linked.includes('No Wowhead link'), 'linked item not warned');
});

test('buildEditWizard: prefills the current slot and carries the item id in every control', () => {
  const it = item({ id: 'a', name: 'Alpha', slot: 'head' });
  const rows = buildEditWizard(it).components.map((r) => r.toJSON().components[0]);
  const slot = rows.find((c) => c.custom_id === encodeStashId('ewslot', 'itm_a', ''));
  const donor = rows.find((c) => c.custom_id === encodeStashId('ewdon', 'itm_a', 'head'));
  const next = rows.find((c) => c.custom_id === encodeStashId('ewnx', 'itm_a', 'head', ''));
  assert.ok(slot, 'slot select carries the item id + empty donor');
  assert.equal(
    slot.options.find((o) => o.value === 'head').default,
    true,
    'current slot marked default'
  );
  assert.ok(donor, 'donor select carries the item id + current slot');
  assert.equal(donor.type, 5, 'donor is a user select');
  assert.ok(next, 'Next carries id + slot + empty donor');
});

test('buildEditWizard: a cleared slot + fresh donor pick ride the ids with no default', () => {
  const it = item({ id: 'a', name: 'Alpha', slot: 'head' });
  const rows = buildEditWizard(it, { slot: null, donorId: '42' }).components.map(
    (r) => r.toJSON().components[0]
  );
  assert.ok(
    rows.some((c) => c.custom_id === encodeStashId('ewnx', 'itm_a', '', '42')),
    'Next carries cleared slot + chosen donor'
  );
  const slot = rows.find((c) => c.custom_id === encodeStashId('ewslot', 'itm_a', '42'));
  assert.ok(slot, 'slot select carries the chosen donor');
  assert.ok(!slot.options.some((o) => o.default), 'no slot marked default when cleared');
});

test('buildEditModal: prefills free text and routes edits with id + slot + donor', () => {
  const it = item({ id: 'a', name: 'Alpha', wowheadId: '12977', notes: 'mint' });
  const json = buildEditModal(it, { slot: 'head', donorId: '42' }).toJSON();
  assert.equal(
    json.custom_id,
    encodeStashId('edits', 'itm_a', 'head', '42'),
    'submit id carries id + slot + donor'
  );
  const inputs = json.components.map((r) => r.components[0]);
  assert.deepEqual(
    inputs.map((c) => c.custom_id),
    ['name', 'wowhead', 'notes'],
    'three free-text fields, no quantity'
  );
  assert.equal(inputs.find((c) => c.custom_id === 'name').value, 'Alpha', 'name prefilled');
  assert.equal(inputs.find((c) => c.custom_id === 'wowhead').value, '12977', 'wowhead prefilled');
  assert.equal(inputs.find((c) => c.custom_id === 'notes').value, 'mint', 'notes prefilled');
});

test('buildManagerPanel: always offers an Add Item button', () => {
  const ids = buttonIds(buildManagerPanel());
  assert.ok(ids.includes(encodeStashId('madd')), 'Add Item button present even when empty');
});

test('buildAddModal: routes madds with slot+donor in its id and free-text fields', () => {
  const json = buildAddModal('head', '42').toJSON();
  assert.equal(
    json.custom_id,
    encodeStashId('madds', 'head', '42'),
    'submit id carries slot + donor'
  );
  const inputs = json.components.map((r) => r.components[0]);
  assert.deepEqual(
    inputs.map((c) => c.custom_id),
    ['name', 'quantity', 'wowhead', 'notes'],
    'four free-text fields in order (slot/donor moved to the wizard)'
  );
  const name = inputs.find((c) => c.custom_id === 'name');
  assert.equal(name.required, true, 'name is required');
  assert.equal(inputs.find((c) => c.custom_id === 'notes').required, false, 'notes is optional');
});

test('buildAddModal: default (no picks) yields empty slot/donor id segments', () => {
  const json = buildAddModal().toJSON();
  assert.equal(json.custom_id, encodeStashId('madds', '', ''), 'empty segments when unset');
  assert.deepEqual(parseStashCustomId(json.custom_id), { action: 'madds', args: ['', ''] });
});

test('buildAddWizard: default renders a slot select, a donor user-picker, and Next', () => {
  const rows = buildAddWizard().components.map((r) => r.toJSON().components[0]);
  const slot = rows.find((c) => c.custom_id === encodeStashId('awslot', ''));
  const donor = rows.find((c) => c.custom_id === encodeStashId('awdon', ''));
  const next = rows.find((c) => c.custom_id === encodeStashId('awnx', '', ''));
  assert.ok(slot, 'slot select present, carrying an empty donor');
  assert.equal(slot.type, 3, 'component type 3 is a string select');
  assert.equal(slot.options.length, STASH_SLOTS.length, 'all slots offered');
  assert.equal(slot.min_values, 0, 'slot is optional');
  assert.ok(donor, 'donor user-select present, carrying an empty slot');
  assert.equal(donor.type, 5, 'component type 5 is a user select');
  assert.equal(donor.min_values, 0, 'donor is optional');
  assert.ok(next, 'Next button present');
});

test('buildAddWizard: a partial pick rides into the other controls ids and marks the slot', () => {
  const rows = buildAddWizard({ slot: 'head', donorId: '42' }).components.map(
    (r) => r.toJSON().components[0]
  );
  assert.ok(
    rows.some((c) => c.custom_id === encodeStashId('awslot', '42')),
    'slot select carries the chosen donor'
  );
  assert.ok(
    rows.some((c) => c.custom_id === encodeStashId('awdon', 'head')),
    'donor select carries the chosen slot'
  );
  assert.ok(
    rows.some((c) => c.custom_id === encodeStashId('awnx', 'head', '42')),
    'Next carries both picks'
  );
  const slot = rows.find((c) => c.custom_id === encodeStashId('awslot', '42'));
  assert.equal(
    slot.options.find((o) => o.value === 'head').default,
    true,
    'chosen slot is marked default'
  );
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
