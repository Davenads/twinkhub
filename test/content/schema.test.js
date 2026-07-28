import test from 'node:test';
import assert from 'node:assert/strict';
import {
  validateIndex,
  validateMeta,
  validateClassIndex,
  validateClass,
  validateEnchants,
  validateGearIndex,
  validateGearClass
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
