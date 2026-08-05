import test from 'node:test';
import assert from 'node:assert/strict';
import { loadContentStore } from '../../src/content/store.js';
import {
  PANEL_VERSION,
  encodeCustomId,
  parseCustomId,
  buildPanels,
  bisFollowups,
  buildPicker
} from '../../src/services/panels.js';

// The select options of a buildPicker row (or [] when null).
function pickerOptions(row) {
  return row ? row.toJSON().components[0].options : [];
}

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

test('buildPanels produces the class-picker panel wired to the class hub', async () => {
  const store = await loadContentStore();
  const panels = buildPanels({ store, bracket: '19' });

  const classBuilds = panels.find((p) => p.key === 'classBuilds');
  assert.ok(classBuilds, 'a classBuilds panel is built');

  const select = classBuilds.components[0].toJSON().components[0];
  assert.equal(select.custom_id, encodeCustomId('pick', 'hub'));
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

test('buildPicker options carry build ids and route to the build action', async () => {
  const store = await loadContentStore();
  const row = buildPicker({ store, bracket: '19', className: 'rogue' });
  assert.ok(row, 'rogue has a build picker');
  assert.equal(row.toJSON().components[0].custom_id, encodeCustomId('build', 'rogue'));
  const values = pickerOptions(row).map((o) => o.value);
  assert.ok(values.includes('rogue-offense-alliance'), 'option value is the build id (faction-encoded)');
});

test('buildPicker appends the faction suffix only where a role spans both sides', async () => {
  const store = await loadContentStore();
  // rogue: Offense exists on both factions -> suffix required to disambiguate.
  const rogue = pickerOptions(buildPicker({ store, bracket: '19', className: 'rogue' }));
  assert.ok(rogue.some((o) => o.label === 'Offense \u2014 Horde'), 'rogue Offense disambiguated');
  assert.ok(rogue.some((o) => o.label === 'Offense \u2014 Alliance'), 'both sides labelled');

  // shaman: Horde-only -> no suffix, labels stay the bare role name.
  const shaman = pickerOptions(buildPicker({ store, bracket: '19', className: 'shaman' }));
  assert.ok(shaman.length > 0, 'shaman has builds');
  assert.ok(shaman.every((o) => !o.label.includes('\u2014')), 'single-faction class carries no faction suffix');
});

test('buildPicker marks the selected build as the default option', async () => {
  const store = await loadContentStore();
  const opts = pickerOptions(
    buildPicker({ store, bracket: '19', className: 'rogue', selectedId: 'rogue-midfield-alliance' })
  );
  const selected = opts.filter((o) => o.default);
  assert.equal(selected.length, 1, 'exactly one option is defaulted');
  assert.equal(selected[0].value, 'rogue-midfield-alliance', 'the selected build id is defaulted');
});

test('buildPicker returns null for a class with no authored builds', async () => {
  const store = await loadContentStore();
  assert.equal(buildPicker({ store, bracket: '19', className: 'nonexistent' }), null);
});
