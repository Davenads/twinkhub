import test from 'node:test';
import assert from 'node:assert/strict';
import {
  loadContentStore,
  getContentStore,
  reloadContentStore,
  summarizeStore,
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
  statweightsForClass,
  bracketPets,
  listPetFamilies,
  getPetFamily,
  bracketSpellcoef,
  listSpellcoefClasses,
  spellcoefForClass,
  bracketConsumables,
  listConsumableTypes,
  consumablesFor,
  bracketQuests,
  questsFor,
  bracketGuides,
  listGuides,
  getGuide,
  guidesFor
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

test('rogue is authored end-to-end: tier-A detail and a merged BiS list', async () => {
  const store = await loadContentStore();

  // Class detail resolves with the roster tier and rogue-specific stat priority.
  const rogue = getClass(store, '19', 'Rogue');
  assert.equal(rogue.class, 'rogue');
  assert.equal(rogue.tier, 'A');
  assert.ok(rogue.specs.length > 0);
  assert.ok(rogue.specs[0].statPriority.includes('agility'));
  assert.ok(rogue.factionNotes, 'carries faction notes surfaced by /class and /optimize');

  // Gear list is registered and merges the rogue anchor with the shared set.
  assert.ok(listGearClasses(store, '19').includes('rogue'));
  const gear = gearForClass(store, '19', 'Rogue');
  assert.equal(gear.className, 'rogue');
  const shadowfang = gear.items.find((i) => i.id === 'shadowfang');
  assert.ok(shadowfang, 'rogue anchor is present');
  assert.equal(shadowfang.owner, 'rogue');
  assert.equal(shadowfang.slot, 'mainhand');
  assert.equal(shadowfang.enchant, 'fiery-weapon');
  assert.ok(getEnchant(store, '19', shadowfang.enchant), 'its enchant resolves');
  assert.ok(gear.items.some((i) => i.owner === 'shared'), 'shared items are merged in');
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

test('priest is authored as a tier-A healer with mana-first stat weights', async () => {
  const store = await loadContentStore();

  const priest = getClass(store, '19', 'Priest');
  assert.equal(priest.class, 'priest');
  assert.equal(priest.tier, 'A');
  assert.ok(priest.roles.includes('healer'));
  assert.ok(priest.specs.length > 0);
  assert.ok(priest.specs[0].statPriority.includes('intellect'));
  assert.ok(priest.factionNotes, 'carries faction notes surfaced by /class and /optimize');

  // Stat weights are registered and lead with the caster stats.
  assert.ok(listStatweightClasses(store, '19').includes('priest'));
  const sw = statweightsForClass(store, '19', 'Priest');
  assert.equal(sw.className, 'priest');
  assert.equal(sw.entry.priority[0], 'intellect');
  assert.ok(sw.entry.priority.includes('stamina'));
});

test('loadContentStore loads hunter pets with a valid class reference', async () => {
  const store = await loadContentStore();

  const pets = bracketPets(store, '19');
  assert.ok(pets, 'pets are loaded');
  assert.equal(pets.class, 'hunter');
  // A strict load reaching here proves the pets class is a real roster class.
  assert.ok(listClassNames(store, '19').includes(pets.class), 'pets class is a roster class');

  const families = listPetFamilies(store, '19');
  assert.ok(families.includes('boar'));
  assert.ok(families.includes('cat'));

  const cat = getPetFamily(store, '19', 'Cat');
  assert.ok(cat, 'family lookup is case-insensitive');
  assert.equal(cat.family, 'cat');

  assert.equal(getPetFamily(store, '19', 'dragon'), null);
  assert.equal(bracketPets(store, '49'), null);
  assert.deepEqual(listPetFamilies(store, '49'), []);
});

test('loadContentStore loads spell coefficients with valid class references', async () => {
  const store = await loadContentStore();

  const data = bracketSpellcoef(store, '19');
  assert.ok(data, 'spell coefficients are loaded');
  assert.equal(typeof data.penalty.perLevelBelow20, 'number');

  const classes = listSpellcoefClasses(store, '19');
  assert.ok(classes.includes('mage'));

  // A strict load reaching here proves every byClass key is a real roster class.
  const roster = new Set(listClassNames(store, '19'));
  for (const cls of classes) assert.ok(roster.has(cls), `${cls} is a roster class`);

  const mage = spellcoefForClass(store, '19', 'Mage');
  assert.ok(Array.isArray(mage) && mage.length > 0, 'lookup is case-insensitive');
  assert.ok(mage.some((s) => s.spell === 'Frostbolt'));

  assert.equal(spellcoefForClass(store, '19', 'notaclass'), null);
  assert.equal(bracketSpellcoef(store, '49'), null);
  assert.deepEqual(listSpellcoefClasses(store, '49'), []);
});

test('loadContentStore loads consumables with valid class references and filters cleanly', async () => {
  const store = await loadContentStore();

  const data = bracketConsumables(store, '19');
  assert.ok(data, 'consumables are loaded');
  assert.ok(data.consumables.length > 0);

  const types = listConsumableTypes(store, '19');
  assert.ok(types.includes('potion'));

  // A strict load reaching here proves every class-specific consumable names a
  // real roster class.
  const roster = new Set(listClassNames(store, '19'));
  for (const c of data.consumables) {
    for (const cls of c.classes ?? []) assert.ok(roster.has(cls), `${cls} is a roster class`);
  }

  // Type filter.
  const potions = consumablesFor(store, '19', { type: 'potion' });
  assert.ok(potions.length > 0 && potions.every((c) => c.type === 'potion'));

  // Class filter keeps universal consumables plus class-specific ones; rogue sees
  // the poison, a class without a poison does not.
  const rogue = consumablesFor(store, '19', { className: 'Rogue' });
  assert.ok(rogue.some((c) => c.id === 'venomhide-poison'), 'rogue sees its poison');
  assert.ok(rogue.some((c) => !c.classes), 'rogue also sees universal consumables');
  const priest = consumablesFor(store, '19', { className: 'priest' });
  assert.ok(!priest.some((c) => c.id === 'venomhide-poison'), 'priest does not see the rogue poison');

  assert.equal(bracketConsumables(store, '49'), null);
  assert.deepEqual(consumablesFor(store, '49', { type: 'potion' }), []);
  assert.deepEqual(listConsumableTypes(store, '49'), []);
});

test('loadContentStore loads quests with valid reward/class references and filters cleanly', async () => {
  const store = await loadContentStore();

  const data = bracketQuests(store, '19');
  assert.ok(data, 'quests are loaded');
  assert.ok(data.quests.length > 0);

  // A strict load reaching here proves every reward.itemId resolves to a real
  // gear item and every class-specific quest names a real roster class.
  const roster = new Set(listClassNames(store, '19'));
  for (const q of data.quests) {
    assert.equal(typeof q.xpWarning, 'boolean');
    if (q.reward.itemId) assert.ok(getGearItem(store, '19', q.reward.itemId), `${q.id} reward resolves`);
    for (const cls of q.classes ?? []) assert.ok(roster.has(cls), `${cls} is a roster class`);
  }

  // The seeded Alliance hunter quest surfaces under matching filters and is
  // excluded by a mismatched faction.
  const nightWatch = data.quests.find((q) => q.id === 'the-night-watch');
  assert.ok(nightWatch, 'seeded Alliance quest is present');
  assert.ok(questsFor(store, '19', { faction: 'alliance' }).some((q) => q.id === 'the-night-watch'));
  assert.ok(!questsFor(store, '19', { faction: 'horde' }).some((q) => q.id === 'the-night-watch'));
  assert.ok(questsFor(store, '19', { className: 'Hunter' }).some((q) => q.id === 'the-night-watch'));

  assert.equal(bracketQuests(store, '49'), null);
  assert.deepEqual(questsFor(store, '49', { faction: 'alliance' }), []);
});

test('loadContentStore loads guides with a matching body slug and valid class refs', async () => {
  const store = await loadContentStore();

  const guides = bracketGuides(store, '19');
  assert.ok(guides, 'guides are loaded');
  assert.ok(guides.list.length > 0, 'catalogue is non-empty');

  // A strict load reaching here proves each body slug matched its index entry and
  // any guide `class` names a real roster class.
  const roster = new Set(listClassNames(store, '19'));
  for (const g of guides.list) {
    if (g.class != null) assert.ok(roster.has(g.class), `${g.class} is a roster class`);
  }

  // The seeded basics guide resolves by slug (case-insensitive) and paginates.
  const basics = getGuide(store, '19', '19-Twink-Basics');
  assert.ok(basics, 'seeded guide body resolves case-insensitively');
  assert.equal(basics.slug, '19-twink-basics');
  assert.ok(Array.isArray(basics.sections) && basics.sections.length > 0);

  // Browse filters: a matching tag keeps it, a non-matching tag drops it.
  assert.ok(guidesFor(store, '19', { tag: 'beginner' }).some((g) => g.slug === '19-twink-basics'));
  assert.deepEqual(guidesFor(store, '19', { tag: 'nope-not-a-tag' }), []);
  // A class-less guide is universal, surfacing for any class filter.
  assert.ok(guidesFor(store, '19', { className: 'Hunter' }).some((g) => g.slug === '19-twink-basics'));

  assert.equal(bracketGuides(store, '49'), null);
  assert.deepEqual(listGuides(store, '49'), []);
  assert.equal(getGuide(store, '49', 'x'), null);
});

test('reloadContentStore reloads from disk and summarizeStore reports per-bracket counts', async () => {
  const result = await reloadContentStore();
  assert.equal(result.ok, true);
  assert.ok(result.store.bracketKeys.includes('19'));

  const s19 = summarizeStore(result.store).find((s) => s.bracket === '19');
  assert.ok(s19, 'summary includes the 19 bracket');
  assert.ok(s19.classes > 0, 'reports class count');
  assert.ok(s19.gearItems > 0, 'reports gear item count');
  assert.ok(s19.scalingClasses > 0, 'reports stat-weight class count');
  assert.ok(s19.guides > 0, 'reports guide count');
});

test('reloadContentStore fails cleanly and keeps the last-good store on a bad load', async () => {
  // Prime a known-good singleton.
  const good = await reloadContentStore();
  assert.equal(good.ok, true);
  const before = await getContentStore();

  // Point a reload at a directory with no index.json: the strict load throws
  // before the singleton is reassigned, so we get a failure result and the
  // previously loaded store keeps serving.
  const result = await reloadContentStore({ dir: './does-not-exist-twinkhub-xyz' });
  assert.equal(result.ok, false);
  assert.ok(result.error instanceof Error);
  assert.equal(await getContentStore(), before, 'last-good store is still served');
});
