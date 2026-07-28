import test from 'node:test';
import assert from 'node:assert/strict';
import {
  loadContentStore,
  primaryBracket,
  listClassNames,
  getClass,
  bracketEnchants,
  listEnchantSlots
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
