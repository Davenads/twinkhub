import test from 'node:test';
import assert from 'node:assert/strict';
import {
  loadContentStore,
  primaryBracket,
  listClassNames,
  getClass,
  bracketEnchants,
  getEnchant,
  listEnchantSlots,
  gearSlots,
  listGearClasses,
  listGearItems,
  getGearItem,
  gearForClass,
  bracketScaling,
  listStatweightClasses,
  statweightsForClass
} from '../../src/content/store.js';

// Integration: load the real seeded store from data/content (path is resolved
// relative to src/content, so it works regardless of the test runner's cwd).
test('loadContentStore validates and indexes the seeded 19 bracket', async () => {
  const store = await loadContentStore();
  assert.ok(Number.isInteger(store.schemaVersion));
  assert.ok(store.bracketKeys.includes('19'));

  const meta = store.brackets['19'].meta;
  assert.equal(meta.levelCap, 19);
  assert.equal(meta.battleground, 'Warsong Gulch');
  assert.equal(meta.gameVersion.flavor, 'classic-era');
});

test('primaryBracket falls back to 19 and honors activeBrackets order', () => {
  assert.equal(primaryBracket(null), '19');
  assert.equal(primaryBracket({}), '19');
  assert.equal(primaryBracket({ activeBrackets: [] }), '19');
  assert.equal(primaryBracket({ activeBrackets: ['29', '19'] }), '29');
});

test('loadContentStore indexes the class roster and per-class detail', async () => {
  const store = await loadContentStore();
  const classes = store.brackets['19'].classes;

  assert.ok(classes.index.classes.length > 0);
  const hunter = classes.byClass.hunter;
  assert.ok(hunter, 'hunter detail is loaded');
  assert.equal(hunter.tier, 'S');
  assert.ok(hunter.specs.length > 0);
  assert.ok(hunter.specs[0].statPriority.includes('agility'));
});

test('listClassNames returns roster keys; empty for an unknown bracket', async () => {
  const store = await loadContentStore();
  const names = listClassNames(store, '19');
  assert.ok(names.includes('hunter'));
  assert.deepEqual(listClassNames(store, '49'), []);
});

test('getClass prefers detail, falls back to roster, and is case-insensitive', async () => {
  const store = await loadContentStore();
  const hunter = getClass(store, '19', 'Hunter');
  assert.equal(hunter.class, 'hunter');
  assert.ok(hunter.specs, 'detail file carries specs');

  // A roster class without a detail file still resolves (roster-only entry).
  const rosterOnly = store.brackets['19'].classes.index.classes.find(
    (e) => !store.brackets['19'].classes.byClass[e.class]
  );
  if (rosterOnly) {
    const resolved = getClass(store, '19', rosterOnly.class);
    assert.equal(resolved.class, rosterOnly.class);
    assert.equal(resolved.specs, undefined);
  }

  assert.equal(getClass(store, '19', 'notaclass'), null);
});

test('loadContentStore loads the enchants file and passes the referential class check', async () => {
  const store = await loadContentStore();
  const data = bracketEnchants(store, '19');
  assert.ok(data, 'enchants are loaded');
  assert.ok(data.enchants.some((e) => e.id === 'fiery-weapon'));

  // Referential guard: every enchant class is a real roster class (load is
  // strict, so a bad reference would have thrown before we get here).
  const roster = new Set(listClassNames(store, '19'));
  for (const ench of data.enchants) {
    for (const cls of ench.classes) assert.ok(roster.has(cls), `${cls} is a roster class`);
  }
});

test('listEnchantSlots returns distinct slots; empty for an unknown bracket', async () => {
  const store = await loadContentStore();
  const slots = listEnchantSlots(store, '19');
  assert.ok(slots.includes('weapon'));
  assert.equal(new Set(slots).size, slots.length, 'no duplicate slots');
  assert.deepEqual(listEnchantSlots(store, '49'), []);
});

test('loadContentStore indexes gear with unique ids and declared slots', async () => {
  const store = await loadContentStore();

  const slots = gearSlots(store, '19');
  assert.ok(slots.includes('head'));

  const items = listGearItems(store, '19');
  assert.ok(items.length > 0);
  const ids = items.map((i) => i.id);
  assert.equal(new Set(ids).size, ids.length, 'ids are unique bracket-wide');
  for (const it of items) assert.ok(slots.includes(it.slot), `${it.id} slot "${it.slot}" is declared`);

  const goggles = getGearItem(store, '19', 'green-tinted-goggles');
  assert.ok(goggles, 'shared item resolves by id');
  assert.equal(goggles.owner, 'shared');
  assert.equal(getGearItem(store, '19', 'nope'), null);
});

test('getEnchant resolves a seeded enchant by id; null for an unknown id', async () => {
  const store = await loadContentStore();
  const fiery = getEnchant(store, '19', 'fiery-weapon');
  assert.ok(fiery, 'enchant resolves by id');
  assert.equal(fiery.slot, 'weapon');
  assert.equal(getEnchant(store, '19', 'nope'), null);
});

test('enriched item references pass the referential guard (strict load succeeded)', async () => {
  const store = await loadContentStore();

  // A strict load reaching here proves every enchant/alternatives reference
  // resolved. Spot-check the seeded links and that they point at real records.
  const goggles = getGearItem(store, '19', 'green-tinted-goggles');
  assert.ok(goggles.alternatives.includes('lucky-fishing-hat'));
  assert.ok(getGearItem(store, '19', 'lucky-fishing-hat'), 'alternative resolves to a real item');

  const boots = getGearItem(store, '19', 'feet-of-the-lynx');
  assert.equal(boots.enchant, 'minor-speed-boots');
  assert.ok(getEnchant(store, '19', boots.enchant), 'recommended enchant resolves to a real enchant');
  assert.ok(boots.alternatives.includes('trailblazer-boots'));
});

test('shared set fills the neck slot and cross-links the stat rings', async () => {
  const store = await loadContentStore();

  const neck = getGearItem(store, '19', 'sentinels-medallion');
  assert.ok(neck, 'a neck item is authored');
  assert.equal(neck.slot, 'neck');
  assert.ok(listGearItems(store, '19').some((i) => i.slot === 'neck'), 'neck slot is populated');

  // The two stat rings list each other as alternatives; a strict load reaching
  // here proves those references resolved.
  const viridian = getGearItem(store, '19', 'viridian-band');
  assert.ok(viridian.alternatives.includes('blood-ring'));
  const blood = getGearItem(store, '19', 'blood-ring');
  assert.ok(blood.alternatives.includes('viridian-band'));
});

test('gearForClass merges shared + class items; null when class has no BiS', async () => {
  const store = await loadContentStore();

  assert.ok(listGearClasses(store, '19').includes('hunter'));

  const hunter = gearForClass(store, '19', 'Hunter');
  assert.equal(hunter.className, 'hunter');
  assert.ok(hunter.items.some((i) => i.owner === 'shared'), 'includes shared items');
  assert.ok(hunter.items.some((i) => i.owner === 'hunter'), 'includes hunter items');

  // A roster class without an authored gear file yields null (clean degrade).
  const withoutGear = listClassNames(store, '19').find((c) => !listGearClasses(store, '19').includes(c));
  if (withoutGear) assert.equal(gearForClass(store, '19', withoutGear), null);
});

test('loadContentStore loads scaling with valid per-class priority references', async () => {
  const store = await loadContentStore();

  const scaling = bracketScaling(store, '19');
  assert.ok(scaling, 'scaling is loaded');
  assert.ok(scaling.stats.agility, 'agility is a declared stat');

  const classes = listStatweightClasses(store, '19');
  assert.ok(classes.includes('hunter'));

  const hunter = statweightsForClass(store, '19', 'Hunter');
  assert.equal(hunter.className, 'hunter');
  assert.ok(hunter.entry.priority.includes('agility'));

  // A strict load reaching here proves every class priority stat is a declared
  // stat and every scaling class is a real roster class.
  const roster = new Set(listClassNames(store, '19'));
  for (const [cls, entry] of Object.entries(scaling.classes)) {
    assert.ok(roster.has(cls), `${cls} is a roster class`);
    for (const s of entry.priority) assert.ok(scaling.stats[s], `${s} is a declared stat`);
  }

  assert.equal(statweightsForClass(store, '19', 'notaclass'), null);
  assert.deepEqual(listStatweightClasses(store, '49'), []);
  assert.equal(bracketScaling(store, '49'), null);
});
