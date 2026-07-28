import test from 'node:test';
import assert from 'node:assert/strict';
import { validateIndex, validateMeta } from '../../src/content/schema.js';

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
