import test from 'node:test';
import assert from 'node:assert/strict';
import {
  statLine,
  itemLine,
  slotFields,
  wowheadItemUrl,
  itemNameMarkup,
  buildItemLine,
  enchantWowheadUrl,
  enchantNameMarkup
} from '../../src/services/gearFormat.js';

test('statLine formats stat entries with capitalized keys, empty for none', () => {
  assert.equal(statLine({ agility: 6, stamina: 6 }), '+6 Agility, +6 Stamina');
  assert.equal(statLine(null), '');
  assert.equal(statLine(undefined), '');
});

test('itemLine bolds the name and annotates non-both faction and non-core priority', () => {
  const line = itemLine({
    name: 'Insignia of the Alliance',
    faction: 'alliance',
    priority: 'situational',
    source: { type: 'pvp', detail: 'Honor' }
  });
  assert.ok(line.startsWith('**Insignia of the Alliance**'));
  assert.ok(line.includes('[alliance]'));
  assert.ok(line.includes('(situational)'));
  assert.ok(line.includes('pvp: Honor'));
});

test('itemLine omits faction tag for both and priority tag for core', () => {
  const line = itemLine({ name: 'Green Tinted Goggles', faction: 'both', priority: 'core' });
  assert.equal(line, '**Green Tinted Goggles**');
});

test('itemLine joins stats and source with a middle dot', () => {
  const line = itemLine({
    name: 'Goggles',
    faction: 'both',
    priority: 'core',
    stats: { agility: 6 },
    source: { type: 'profession', detail: 'Engineering' }
  });
  assert.ok(line.includes('+6 Agility \u00b7 profession: Engineering'));
});

test('itemLine appends an italic marker for a recommended enchant and alternatives', () => {
  const line = itemLine({
    name: 'Feet of the Lynx',
    faction: 'both',
    priority: 'core',
    source: { type: 'world', detail: 'World drop' },
    enchant: 'minor-speed-boots',
    alternatives: ['trailblazer-boots']
  });
  assert.ok(line.includes('_enchant, 1 alt_'));
});

test('itemLine pluralizes the alternatives count and shows it without an enchant', () => {
  const line = itemLine({
    name: 'Viridian Band',
    faction: 'both',
    priority: 'core',
    alternatives: ['blood-ring', 'other-ring']
  });
  assert.ok(line.includes('_2 alts_'));
  assert.ok(!line.includes('enchant'));
});

test('itemLine adds no marker when there is no enchant or alternatives', () => {
  const line = itemLine({
    name: 'Talbar Mantle',
    faction: 'both',
    priority: 'core',
    source: { type: 'quest', detail: 'Quest reward' }
  });
  assert.ok(!line.includes('_'));
});

test('slotFields groups by slot in declared order, unknown slots last', () => {
  const items = [
    { name: 'B', slot: 'trinket', priority: 'core' },
    { name: 'A', slot: 'head', priority: 'core' },
    { name: 'Z', slot: 'tabard', priority: 'core' }
  ];
  const fields = slotFields(items, ['head', 'trinket']);
  assert.deepEqual(
    fields.map((f) => f.name),
    ['Head', 'Trinket', 'Tabard']
  );
});

test('slotFields sorts core above situational above budget within a slot', () => {
  const items = [
    { name: 'Budget', slot: 'trinket', priority: 'budget' },
    { name: 'Situational', slot: 'trinket', priority: 'situational' },
    { name: 'Core', slot: 'trinket', priority: 'core' }
  ];
  const [field] = slotFields(items, ['trinket']);
  assert.ok(field.value.indexOf('Core') < field.value.indexOf('Situational'));
  assert.ok(field.value.indexOf('Situational') < field.value.indexOf('Budget'));
});

test('slotFields caps the number of returned fields', () => {
  const items = ['a', 'b', 'c'].map((s) => ({ name: s, slot: s, priority: 'core' }));
  const fields = slotFields(items, ['a', 'b', 'c'], 2);
  assert.equal(fields.length, 2);
});

test('wowheadItemUrl builds the Classic item page URL', () => {
  assert.equal(wowheadItemUrl(10399), 'https://www.wowhead.com/classic/item=10399');
});

test('itemNameMarkup wraps the name in a masked Wowhead link when wowheadId is present', () => {
  assert.equal(
    itemNameMarkup({ name: 'Green Tinted Goggles', wowheadId: 10399 }),
    '**[Green Tinted Goggles](https://www.wowhead.com/classic/item=10399)**'
  );
});

test('itemNameMarkup degrades to plain bold (no link) when wowheadId is absent', () => {
  const markup = itemNameMarkup({ name: 'Mystery Trinket' });
  assert.equal(markup, '**Mystery Trinket**');
  assert.ok(!markup.includes(']('), 'must not emit a broken masked link');
});

test('itemLine (/bis flat view + /gear) links the item name when linkable', () => {
  const line = itemLine({ name: 'Green Tinted Goggles', faction: 'both', priority: 'core', wowheadId: 10399 });
  assert.ok(line.includes('](https://www.wowhead.com/classic/item=10399)'), 'links the name');
});

test('buildItemLine (/bis build view) links the name and keeps the enchant suffix', () => {
  const line = buildItemLine(
    { name: 'Green Tinted Goggles', faction: 'both', priority: 'core', wowheadId: 10399 },
    { name: 'Lesser Arcanum of Voracity', wowhead: { type: 'item', id: 11647 } }
  );
  assert.ok(line.includes('](https://www.wowhead.com/classic/item=10399)'), 'links the name');
  assert.ok(
    line.includes('_[Lesser Arcanum of Voracity](https://www.wowhead.com/classic/item=11647)_'),
    'links the per-slot enchant as italic masked link'
  );
});

test('enchantWowheadUrl builds spell= and item= Classic URLs, null without a ref', () => {
  assert.equal(
    enchantWowheadUrl({ name: 'Crusader', wowhead: { type: 'spell', id: 20034 } }),
    'https://www.wowhead.com/classic/spell=20034'
  );
  assert.equal(
    enchantWowheadUrl({ name: 'Might of the Scourge', wowhead: { type: 'item', id: 23548 } }),
    'https://www.wowhead.com/classic/item=23548'
  );
  assert.equal(enchantWowheadUrl({ name: 'Unreferenced' }), null);
  assert.equal(enchantWowheadUrl(null), null);
});

test('enchantNameMarkup wraps the name in an italic masked link when referenced', () => {
  assert.equal(
    enchantNameMarkup({ name: 'Enchant Weapon - Crusader', wowhead: { type: 'spell', id: 20034 } }),
    '_[Enchant Weapon - Crusader](https://www.wowhead.com/classic/spell=20034)_'
  );
});

test('enchantNameMarkup degrades to plain italic (no link) when unreferenced, empty for none', () => {
  const markup = enchantNameMarkup({ name: 'Mystery Enchant' });
  assert.equal(markup, '_Mystery Enchant_');
  assert.ok(!markup.includes(']('), 'must not emit a broken masked link');
  assert.equal(enchantNameMarkup(null), '');
});
