import test from 'node:test';
import assert from 'node:assert/strict';
import { loadContentStore } from '../../src/content/store.js';
import {
  PANEL_VERSION,
  encodeCustomId,
  parseCustomId,
  buildPanels,
  bisFollowups
} from '../../src/services/panels.js';

// Collect the custom_ids of every component across an array of ActionRowBuilders.
function customIds(components) {
  return (components ?? []).flatMap((row) => row.toJSON().components.map((c) => c.custom_id));
}

// Map custom_id -> emoji object for every component across ActionRowBuilders.
function emojiById(components) {
  const out = {};
  for (const row of components ?? []) {
    for (const c of row.toJSON().components) out[c.custom_id] = c.emoji;
  }
  return out;
}

test('encodeCustomId / parseCustomId round-trip a versioned, slug-only id', () => {
  const id = encodeCustomId('bis', 'hunter');
  assert.equal(id, `${PANEL_VERSION}|bis|hunter`);
  assert.deepEqual(parseCustomId(id), { action: 'bis', args: ['hunter'] });
});

test('parseCustomId rejects foreign, stale, and malformed ids', () => {
  assert.equal(parseCustomId('x|bis|hunter'), null, 'wrong version prefix');
  assert.equal(parseCustomId('p2|bis'), null, 'future version');
  assert.equal(parseCustomId('p1'), null, 'no action');
  assert.equal(parseCustomId('p1|'), null, 'empty action');
  assert.equal(parseCustomId(''), null, 'empty string');
  assert.equal(parseCustomId(undefined), null, 'non-string');
});

test('buildPanels produces the class-picker panel wired to the bis picker', async () => {
  const store = await loadContentStore();
  const panels = buildPanels({ store, bracket: '19' });

  const classBuilds = panels.find((p) => p.key === 'classBuilds');
  assert.ok(classBuilds, 'a classBuilds panel is built');

  const select = classBuilds.components[0].toJSON().components[0];
  assert.equal(select.custom_id, encodeCustomId('pick', 'bis'));
  assert.ok(select.options.some((o) => o.value === 'hunter'), 'class select offers hunter');
});

test('buildPanels wires consumable type buttons and reference buttons', async () => {
  const store = await loadContentStore();
  const panels = buildPanels({ store, bracket: '19' });

  const consumables = panels.find((p) => p.key === 'consumables');
  assert.ok(consumables, 'a consumables panel is built');
  assert.ok(customIds(consumables.components).every((id) => id.startsWith('p1|cons|')), 'all controls are type buttons');

  // Representative icons: the potion button carries the HealingPotion emoji.
  const potionEmoji = emojiById(consumables.components)[encodeCustomId('cons', 'potion')];
  assert.equal(potionEmoji?.name, 'HealingPotion', 'potion button carries a representative icon');

  const reference = panels.find((p) => p.key === 'reference');
  const refIds = customIds(reference.components);
  assert.ok(refIds.includes(encodeCustomId('xprules')), 'reference has an XP Rules button');
  assert.ok(refIds.includes(encodeCustomId('tierlist')), 'reference has a Tier List button');
});

test('bisFollowups always carries the class and adds Pets for hunter', async () => {
  const store = await loadContentStore();
  const ids = customIds(bisFollowups({ store, bracket: '19', className: 'hunter' }));
  assert.ok(ids.includes(encodeCustomId('ench', 'hunter')), 'enchants follow-up carries the class');
  assert.ok(ids.includes(encodeCustomId('consc', 'hunter')), 'consumables follow-up carries the class');
  assert.ok(ids.includes(encodeCustomId('pets')), 'hunter gets a Pets follow-up');

  const consEmoji = emojiById(bisFollowups({ store, bracket: '19', className: 'hunter' }))[encodeCustomId('consc', 'hunter')];
  assert.equal(consEmoji?.name, 'HealingPotion', 'consumables follow-up carries a potion icon');
});

test('bisFollowups omits the Pets button for non-hunter classes', async () => {
  const store = await loadContentStore();
  const ids = customIds(bisFollowups({ store, bracket: '19', className: 'rogue' }));
  assert.ok(!ids.includes(encodeCustomId('pets')), 'no Pets button for rogue');
});
