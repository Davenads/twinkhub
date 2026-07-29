import test from 'node:test';
import assert from 'node:assert/strict';
import {
  validateIndex,
  validateMeta,
  validateClassIndex,
  validateClass,
  validateEnchants,
  validateGearIndex,
  validateGearClass,
  validateScaling,
  validatePets,
  validateSpellCoefficients,
  validateConsumables,
  validateQuests,
  validateGuideIndex,
  validateGuide
} from '../../src/content/schema.js';

const validMeta = () => ({
  bracket: '19',
  gameVersion: { flavor: 'classic-era', contentState: 'all-pre-tbc-unlocked', clientPatch: '1.15.x' },
  levelRange: [10, 19],
  levelCap: 19,
  battleground: 'Warsong Gulch',
  xpLock: { available: false, note: 'Manage XP manually.' }
});

test('validateIndex accepts a well-formed registry', () => {
  assert.deepEqual(validateIndex({ schemaVersion: 1, brackets: ['19'] }), { ok: true, errors: [] });
});

test('validateIndex rejects a missing/empty bracket list and bad version', () => {
  assert.equal(validateIndex({ schemaVersion: 1, brackets: [] }).ok, false);
  assert.equal(validateIndex({ schemaVersion: '1', brackets: ['19'] }).ok, false);
  assert.equal(validateIndex(null).ok, false);
});

test('validateMeta accepts the seeded 19 shape', () => {
  assert.deepEqual(validateMeta(validMeta(), '19/meta.json'), { ok: true, errors: [] });
});

test('validateMeta enforces the classic-era game-version gate', () => {
  const sod = { ...validMeta(), gameVersion: { flavor: 'sod', contentState: 'all-pre-tbc-unlocked' } };
  const res = validateMeta(sod, '19/meta.json');
  assert.equal(res.ok, false);
  assert.ok(res.errors.some((e) => e.includes('gameVersion.flavor')));
});

test('validateMeta flags a bad levelRange and a missing xpLock note', () => {
  const bad = { ...validMeta(), levelRange: [19], xpLock: { available: false } };
  const res = validateMeta(bad, '19/meta.json');
  assert.equal(res.ok, false);
  assert.ok(res.errors.some((e) => e.includes('levelRange')));
  assert.ok(res.errors.some((e) => e.includes('xpLock.note')));
});

const validClassIndex = () => ({
  tierNote: 'Tiers are composition-dependent.',
  classes: [
    { class: 'hunter', tier: 'S', roles: ['ranged-dps'], summary: 'Top ranged DPS.' },
    { class: 'rogue', tier: 'A', roles: ['melee-dps'], summary: 'Burst melee.' }
  ]
});

test('validateClassIndex accepts a well-formed roster', () => {
  assert.deepEqual(validateClassIndex(validClassIndex()), { ok: true, errors: [] });
});

test('validateClassIndex rejects an empty roster and bad entries', () => {
  assert.equal(validateClassIndex({ classes: [] }).ok, false);
  const bad = { classes: [{ class: 'hunter', tier: 'S', roles: [], summary: '' }] };
  const res = validateClassIndex(bad);
  assert.equal(res.ok, false);
  assert.ok(res.errors.some((e) => e.includes('roles')));
  assert.ok(res.errors.some((e) => e.includes('summary')));
});

test('validateClassIndex flags a duplicated class key', () => {
  const dupe = validClassIndex();
  dupe.classes.push({ class: 'hunter', tier: 'B', roles: ['ranged-dps'], summary: 'Dupe.' });
  const res = validateClassIndex(dupe);
  assert.equal(res.ok, false);
  assert.ok(res.errors.some((e) => e.includes('duplicated')));
});

const validClass = () => ({
  class: 'hunter',
  tier: 'S',
  roles: ['ranged-dps'],
  summary: 'Top ranged DPS.',
  specs: [{ name: 'BM/MM hybrid', statPriority: ['agility', 'stamina'] }]
});

test('validateClass accepts a full per-class detail file', () => {
  assert.deepEqual(validateClass(validClass()), { ok: true, errors: [] });
});

test('validateClass requires a non-empty specs array with stat priorities', () => {
  assert.equal(validateClass({ ...validClass(), specs: [] }).ok, false);
  const badSpec = { ...validClass(), specs: [{ name: 'BM', statPriority: [] }] };
  const res = validateClass(badSpec);
  assert.equal(res.ok, false);
  assert.ok(res.errors.some((e) => e.includes('statPriority')));
});

const validEnchants = () => ({
  note: 'No-level-req enchants are the twink cornerstone.',
  enchants: [
    {
      id: 'fiery-weapon',
      name: 'Enchant Weapon - Fiery Weapon',
      slot: 'weapon',
      effect: 'Chance on hit: +40 Fire damage.',
      reqLevel: null,
      noLevelReq: true,
      notes: 'Iconic melee twink enchant.',
      classes: ['warrior', 'rogue']
    }
  ]
});

test('validateEnchants accepts a well-formed enchant file', () => {
  assert.deepEqual(validateEnchants(validEnchants()), { ok: true, errors: [] });
});

test('validateEnchants rejects an empty enchant list', () => {
  assert.equal(validateEnchants({ enchants: [] }).ok, false);
});

test('validateEnchants requires a boolean noLevelReq flag', () => {
  const bad = validEnchants();
  delete bad.enchants[0].noLevelReq;
  const res = validateEnchants(bad);
  assert.equal(res.ok, false);
  assert.ok(res.errors.some((e) => e.includes('noLevelReq')));
});

test('validateEnchants flags a duplicated id and a bad reqLevel', () => {
  const dupe = validEnchants();
  dupe.enchants.push({ ...dupe.enchants[0], reqLevel: 'nope' });
  const res = validateEnchants(dupe);
  assert.equal(res.ok, false);
  assert.ok(res.errors.some((e) => e.includes('duplicated')));
  assert.ok(res.errors.some((e) => e.includes('reqLevel')));
});

const validItem = () => ({
  id: 'green-tinted-goggles',
  name: 'Green Tinted Goggles',
  slot: 'head',
  source: { type: 'profession', detail: 'Engineering (crafted)' },
  faction: 'both',
  stats: { agility: 6, stamina: 6 },
  reqLevel: 18,
  wowheadId: null,
  notes: 'BiS head.',
  priority: 'core'
});

test('validateGearIndex accepts slots plus well-formed shared items', () => {
  const ok = { slots: ['head', 'trinket'], notes: 'seed', shared: [validItem()] };
  assert.deepEqual(validateGearIndex(ok), { ok: true, errors: [] });
});

test('validateGearIndex requires a non-empty slots array', () => {
  assert.equal(validateGearIndex({ slots: [], shared: [] }).ok, false);
});

test('validateGearIndex enforces item vocabularies and unique shared ids', () => {
  const badFaction = { slots: ['head'], shared: [{ ...validItem(), faction: 'neutral' }] };
  assert.ok(validateGearIndex(badFaction).errors.some((e) => e.includes('faction')));

  const badSource = { slots: ['head'], shared: [{ ...validItem(), source: { type: 'legendary', detail: 'x' } }] };
  assert.ok(validateGearIndex(badSource).errors.some((e) => e.includes('source.type')));

  const badPriority = { slots: ['head'], shared: [{ ...validItem(), priority: 'godlike' }] };
  assert.ok(validateGearIndex(badPriority).errors.some((e) => e.includes('priority')));

  const dupe = { slots: ['head'], shared: [validItem(), validItem()] };
  assert.ok(validateGearIndex(dupe).errors.some((e) => e.includes('duplicated')));
});

test('validateGearIndex rejects a non-integer stat value', () => {
  const bad = { slots: ['head'], shared: [{ ...validItem(), stats: { agility: '6' } }] };
  const res = validateGearIndex(bad);
  assert.equal(res.ok, false);
  assert.ok(res.errors.some((e) => e.includes('stats.agility')));
});

test('validateGearIndex accepts optional enchant + alternatives references', () => {
  const enriched = { ...validItem(), enchant: 'minor-speed-boots', alternatives: ['lucky-fishing-hat'] };
  assert.deepEqual(validateGearIndex({ slots: ['head'], shared: [enriched] }), { ok: true, errors: [] });
});

test('validateGearIndex rejects a blank enchant and a non-string-array alternatives', () => {
  const badEnchant = { slots: ['head'], shared: [{ ...validItem(), enchant: '' }] };
  assert.ok(validateGearIndex(badEnchant).errors.some((e) => e.includes('enchant')));

  const badAlts = { slots: ['head'], shared: [{ ...validItem(), alternatives: [] }] };
  assert.ok(validateGearIndex(badAlts).errors.some((e) => e.includes('alternatives')));

  const nonStringAlts = { slots: ['head'], shared: [{ ...validItem(), alternatives: [7] }] };
  assert.ok(validateGearIndex(nonStringAlts).errors.some((e) => e.includes('alternatives')));
});

test('validateGearClass accepts a class with a non-empty item list', () => {
  const ok = { class: 'hunter', items: [validItem()] };
  assert.deepEqual(validateGearClass(ok), { ok: true, errors: [] });
});

test('validateGearClass rejects an empty item list and a missing class', () => {
  assert.equal(validateGearClass({ class: 'hunter', items: [] }).ok, false);
  assert.equal(validateGearClass({ items: [validItem()] }).ok, false);
});

const validBuild = () => ({
  id: 'hunter-offense',
  name: 'Offense',
  role: 'offense',
  faction: 'both',
  default: true,
  slots: {
    head: { item: 'lucky-fishing-hat', enchant: 'lesser-arcanum-voracity' },
    waist: { item: 'deviate-scale-belt', enchant: null },
    finger: [
      { item: 'seal-of-sylvanas', enchant: null },
      { item: 'advisors-ring', enchant: null }
    ]
  }
});

test('validateGearClass accepts optional role builds (single + array slots)', () => {
  const ok = { class: 'hunter', items: [validItem()], builds: [validBuild()] };
  assert.deepEqual(validateGearClass(ok), { ok: true, errors: [] });
});

test('validateGearClass enforces the build role/faction vocabularies', () => {
  const badRole = { class: 'hunter', items: [validItem()], builds: [{ ...validBuild(), role: 'tank' }] };
  assert.ok(validateGearClass(badRole).errors.some((e) => e.includes('role')));

  const badFaction = { class: 'hunter', items: [validItem()], builds: [{ ...validBuild(), faction: 'neutral' }] };
  assert.ok(validateGearClass(badFaction).errors.some((e) => e.includes('faction')));
});

test('validateGearClass rejects an empty builds array and a duplicated build id', () => {
  assert.ok(validateGearClass({ class: 'hunter', items: [validItem()], builds: [] }).errors.some((e) => e.includes('builds')));

  const dupe = { class: 'hunter', items: [validItem()], builds: [validBuild(), validBuild()] };
  assert.ok(validateGearClass(dupe).errors.some((e) => e.includes('duplicated')));
});

test('validateGearClass flags a build with empty slots and a bad pick', () => {
  const noSlots = { class: 'hunter', items: [validItem()], builds: [{ ...validBuild(), slots: {} }] };
  assert.ok(validateGearClass(noSlots).errors.some((e) => e.includes('slots')));

  const badPick = validBuild();
  badPick.slots.head = { item: '', enchant: 7 };
  const res = validateGearClass({ class: 'hunter', items: [validItem()], builds: [badPick] });
  assert.equal(res.ok, false);
  assert.ok(res.errors.some((e) => e.includes('slots.head.item')));
  assert.ok(res.errors.some((e) => e.includes('slots.head.enchant')));

  const badArray = validBuild();
  badArray.slots.finger = [];
  assert.ok(validateGearClass({ class: 'hunter', items: [validItem()], builds: [badArray] }).errors.some((e) => e.includes('slots.finger')));
});

const validScaling = () => ({
  note: 'Concrete conversions at 19.',
  stats: {
    agility: { label: 'Agility', summary: 'Armor, crit, dodge, AP.', conversions: ['1 Agility = 2 armor'] },
    stamina: { label: 'Stamina', summary: 'Health.', conversions: ['1 Stamina = 10 health'] }
  },
  derived: [{ name: 'DPS from AP', formula: 'DPS = AP / 14' }],
  hitCaps: [{ type: 'melee', value: '5%' }],
  classes: {
    hunter: { priority: ['agility', 'stamina'], notes: ['Ranged hit cap is 5%.'] }
  }
});

test('validateScaling accepts a well-formed scaling file', () => {
  assert.deepEqual(validateScaling(validScaling()), { ok: true, errors: [] });
});

test('validateScaling requires stats and classes objects with entries', () => {
  assert.equal(validateScaling({ ...validScaling(), stats: {} }).ok, false);
  assert.equal(validateScaling({ ...validScaling(), classes: {} }).ok, false);
  assert.equal(validateScaling({ stats: validScaling().stats }).ok, false);
});

test('validateScaling flags a bad stat entry and a non-array class priority', () => {
  const badStat = validScaling();
  badStat.stats.agility.conversions = [];
  const r1 = validateScaling(badStat);
  assert.equal(r1.ok, false);
  assert.ok(r1.errors.some((e) => e.includes('stats.agility.conversions')));

  const badClass = validScaling();
  badClass.classes.hunter.priority = 'agility';
  const r2 = validateScaling(badClass);
  assert.equal(r2.ok, false);
  assert.ok(r2.errors.some((e) => e.includes('classes.hunter.priority')));
});

test('validateScaling flags malformed derived and hitCaps entries', () => {
  const bad = validScaling();
  bad.derived = [{ name: 'x' }];
  bad.hitCaps = [{ type: 'melee' }];
  const res = validateScaling(bad);
  assert.equal(res.ok, false);
  assert.ok(res.errors.some((e) => e.includes('derived[0].formula')));
  assert.ok(res.errors.some((e) => e.includes('hitCaps[0].value')));
});

const validPets = () => ({
  class: 'hunter',
  families: [
    { family: 'boar', exampleName: 'Great Goretusk', keyAbility: 'Charge', tameLevel: null, zone: null, notes: 'Charge utility.' },
    { family: 'cat', exampleName: 'The Rake', keyAbility: null, attackSpeed: 1.2, tameLevel: null, zone: null, notes: 'Fast swing.' }
  ],
  xpNote: 'Pets need ~25% of player XP and gain none from turn-ins.',
  abilityNote: 'Ability-shop while taming.',
  budgetNote: 'Sync pets first, then turn in.'
});

test('validatePets accepts a well-formed pets file with nullable specifics', () => {
  assert.deepEqual(validatePets(validPets()), { ok: true, errors: [] });
});

test('validatePets requires class, xpNote, and a non-empty families array', () => {
  assert.equal(validatePets({ ...validPets(), class: '' }).ok, false);
  assert.equal(validatePets({ ...validPets(), xpNote: '' }).ok, false);
  assert.equal(validatePets({ ...validPets(), families: [] }).ok, false);
});

test('validatePets flags a family missing notes and a bad attackSpeed', () => {
  const badNotes = validPets();
  delete badNotes.families[0].notes;
  const r1 = validatePets(badNotes);
  assert.equal(r1.ok, false);
  assert.ok(r1.errors.some((e) => e.includes('families[0].notes')));

  const badSpeed = validPets();
  badSpeed.families[1].attackSpeed = '1.2';
  const r2 = validatePets(badSpeed);
  assert.equal(r2.ok, false);
  assert.ok(r2.errors.some((e) => e.includes('attackSpeed')));
});

test('validatePets flags a duplicated family key and a bad tameLevel', () => {
  const dupe = validPets();
  dupe.families.push({ ...dupe.families[0], tameLevel: 'sixteen' });
  const res = validatePets(dupe);
  assert.equal(res.ok, false);
  assert.ok(res.errors.some((e) => e.includes('duplicated')));
  assert.ok(res.errors.some((e) => e.includes('tameLevel')));
});

const validSpellcoef = () => ({
  penalty: { perLevelBelow20: 0.0375, note: 'Sub-20 penalty; coefficients are level-19-effective.' },
  byClass: {
    mage: [
      { spell: 'Frostbolt', rank: 3, coefficient: 0.463, type: 'direct-damage', confirmed: false },
      { spell: 'Fireball', rank: 4, coefficient: 0.793, type: 'direct-damage', confirmed: false },
      { spell: 'Fireball', rank: 4, coefficient: 0, type: 'dot', confirmed: false, notes: 'DoT does not scale.' }
    ],
    priest: [{ spell: 'Lesser Heal', rank: 3, coefficient: 0.446, type: 'direct-heal' }]
  }
});

test('validateSpellCoefficients accepts a well-formed file (same-rank direct+dot allowed)', () => {
  assert.deepEqual(validateSpellCoefficients(validSpellcoef()), { ok: true, errors: [] });
});

test('validateSpellCoefficients requires penalty and a non-empty byClass', () => {
  assert.equal(validateSpellCoefficients({ ...validSpellcoef(), penalty: undefined }).ok, false);
  assert.equal(validateSpellCoefficients({ ...validSpellcoef(), byClass: {} }).ok, false);
  const badPct = validSpellcoef();
  badPct.penalty.perLevelBelow20 = '0.0375';
  assert.ok(validateSpellCoefficients(badPct).errors.some((e) => e.includes('perLevelBelow20')));
});

test('validateSpellCoefficients enforces the type vocabulary and numeric coefficient', () => {
  const badType = validSpellcoef();
  badType.byClass.mage[0].type = 'melee';
  assert.ok(validateSpellCoefficients(badType).errors.some((e) => e.includes('type')));

  const badCoef = validSpellcoef();
  badCoef.byClass.mage[0].coefficient = -1;
  assert.ok(validateSpellCoefficients(badCoef).errors.some((e) => e.includes('coefficient')));

  const badRank = validSpellcoef();
  badRank.byClass.mage[0].rank = '3';
  assert.ok(validateSpellCoefficients(badRank).errors.some((e) => e.includes('rank')));
});

test('validateSpellCoefficients flags a same-type duplicate and a bad confirmed flag', () => {
  const dupe = validSpellcoef();
  dupe.byClass.mage.push({ spell: 'Frostbolt', rank: 3, coefficient: 0.463, type: 'direct-damage' });
  const r1 = validateSpellCoefficients(dupe);
  assert.equal(r1.ok, false);
  assert.ok(r1.errors.some((e) => e.includes('duplicates')));

  const badFlag = validSpellcoef();
  badFlag.byClass.mage[0].confirmed = 'yes';
  assert.ok(validateSpellCoefficients(badFlag).errors.some((e) => e.includes('confirmed')));
});

const validConsumables = () => ({
  note: 'Seeded from verified domain notes.',
  consumables: [
    { id: 'healing-potion', name: 'Healing Potion', type: 'potion', effect: 'Instant heal on cooldown.', faction: 'both', reqLevel: null },
    { id: 'venomhide-poison', name: 'Venomhide Poison', type: 'poison', effect: 'Stacking DPS poison.', classes: ['rogue'] },
    { id: 'heavy-dynamite', name: 'Heavy Dynamite', type: 'explosive', effect: 'Thrown AoE fire.', source: { type: 'profession', detail: 'Engineering (crafted)' } }
  ]
});

test('validateConsumables accepts a well-formed file with optional fields', () => {
  assert.deepEqual(validateConsumables(validConsumables()), { ok: true, errors: [] });
});

test('validateConsumables requires a non-empty consumables array with valid core fields', () => {
  assert.equal(validateConsumables({ consumables: [] }).ok, false);
  const badType = validConsumables();
  badType.consumables[0].type = 'elixir';
  assert.ok(validateConsumables(badType).errors.some((e) => e.includes('type')));
  const badEffect = validConsumables();
  delete badEffect.consumables[0].effect;
  assert.ok(validateConsumables(badEffect).errors.some((e) => e.includes('effect')));
});

test('validateConsumables enforces optional faction/classes/source vocabularies', () => {
  const badFaction = validConsumables();
  badFaction.consumables[0].faction = 'neutral';
  assert.ok(validateConsumables(badFaction).errors.some((e) => e.includes('faction')));

  const badClasses = validConsumables();
  badClasses.consumables[1].classes = [];
  assert.ok(validateConsumables(badClasses).errors.some((e) => e.includes('classes')));

  const badSource = validConsumables();
  badSource.consumables[2].source = { type: 'legendary', detail: 'x' };
  assert.ok(validateConsumables(badSource).errors.some((e) => e.includes('source.type')));
});

test('validateConsumables flags a duplicated id and a bad reqLevel', () => {
  const dupe = validConsumables();
  dupe.consumables.push({ ...dupe.consumables[0], reqLevel: 'twelve' });
  const res = validateConsumables(dupe);
  assert.equal(res.ok, false);
  assert.ok(res.errors.some((e) => e.includes('duplicated')));
  assert.ok(res.errors.some((e) => e.includes('reqLevel')));
});

const validQuests = () => ({
  note: 'Seeded from verified domain notes.',
  quests: [
    { id: 'the-night-watch', name: 'The Night Watch', zone: null, faction: 'alliance', reward: { desc: 'Quiver of the Night Watch' }, xpWarning: true, classes: ['hunter'] },
    { id: 'talbar-mantle', name: 'Talbar Mantle Quest', zone: 'Redridge', faction: 'both', reward: { itemId: 'talbar-mantle' }, xpWarning: false }
  ]
});

test('validateQuests accepts a well-formed file with nullable zone and both reward shapes', () => {
  assert.deepEqual(validateQuests(validQuests()), { ok: true, errors: [] });
});

test('validateQuests requires name, a faction in the vocabulary, and a boolean xpWarning', () => {
  assert.equal(validateQuests({ quests: [] }).ok, false);
  const badFaction = validQuests();
  badFaction.quests[0].faction = 'neutral';
  assert.ok(validateQuests(badFaction).errors.some((e) => e.includes('faction')));
  const badFlag = validQuests();
  badFlag.quests[0].xpWarning = 'yes';
  assert.ok(validateQuests(badFlag).errors.some((e) => e.includes('xpWarning')));
});

test('validateQuests requires reward to carry an itemId or a desc', () => {
  const emptyReward = validQuests();
  emptyReward.quests[0].reward = {};
  const res = validateQuests(emptyReward);
  assert.equal(res.ok, false);
  assert.ok(res.errors.some((e) => e.includes('reward must have an itemId or a desc')));

  const blankItem = validQuests();
  blankItem.quests[1].reward = { itemId: '' };
  assert.ok(validateQuests(blankItem).errors.some((e) => e.includes('reward.itemId')));
});

test('validateQuests flags a non-string zone, a bad classes array, and a duplicated id', () => {
  const badZone = validQuests();
  badZone.quests[0].zone = 7;
  assert.ok(validateQuests(badZone).errors.some((e) => e.includes('zone')));

  const badClasses = validQuests();
  badClasses.quests[0].classes = [];
  assert.ok(validateQuests(badClasses).errors.some((e) => e.includes('classes')));

  const dupe = validQuests();
  dupe.quests.push({ ...dupe.quests[0] });
  assert.ok(validateQuests(dupe).errors.some((e) => e.includes('duplicated')));
});

const validGuideIndex = () => ({
  note: 'Curated guides for the bracket.',
  guides: [
    { slug: '19-twink-basics', title: '19 Twink Basics', summary: 'Start here.', tags: ['beginner', 'xp'] },
    { slug: 'hunter-pets', title: 'Hunter Pets', summary: 'Pet XP and families.', class: 'hunter' }
  ]
});

test('validateGuideIndex accepts a well-formed catalogue with optional class/tags', () => {
  assert.deepEqual(validateGuideIndex(validGuideIndex()), { ok: true, errors: [] });
});

test('validateGuideIndex requires slug/title/summary and rejects a duplicated slug', () => {
  assert.equal(validateGuideIndex({ guides: [] }).ok, false);
  const missing = validGuideIndex();
  delete missing.guides[0].summary;
  assert.ok(validateGuideIndex(missing).errors.some((e) => e.includes('summary')));

  const badTags = validGuideIndex();
  badTags.guides[0].tags = [];
  assert.ok(validateGuideIndex(badTags).errors.some((e) => e.includes('tags')));

  const dupe = validGuideIndex();
  dupe.guides.push({ ...dupe.guides[0] });
  assert.ok(validateGuideIndex(dupe).errors.some((e) => e.includes('duplicated')));
});

const validGuide = () => ({
  slug: '19-twink-basics',
  title: '19 Twink Basics',
  summary: 'Start here.',
  tags: ['beginner'],
  sections: [
    { heading: 'The bracket', body: 'Levels 10\u201319, Warsong Gulch.' },
    { heading: 'Managing XP', body: 'No XP-off toggle in Classic Era.' }
  ]
});

test('validateGuide accepts a well-formed body', () => {
  assert.deepEqual(validateGuide(validGuide()), { ok: true, errors: [] });
});

test('validateGuide requires a non-empty sections array with heading and body', () => {
  const noSections = validGuide();
  noSections.sections = [];
  assert.ok(validateGuide(noSections).errors.some((e) => e.includes('sections')));

  const blankHeading = validGuide();
  blankHeading.sections[0].heading = '';
  assert.ok(validateGuide(blankHeading).errors.some((e) => e.includes('heading')));

  const blankBody = validGuide();
  blankBody.sections[1].body = '   ';
  assert.ok(validateGuide(blankBody).errors.some((e) => e.includes('body')));
});
