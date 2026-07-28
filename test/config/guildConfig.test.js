import test from 'node:test';
import assert from 'node:assert/strict';
import { mergeTimers } from '../../src/config/guildConfig.js';

test('mergeTimers flips one event without clobbering its siblings', () => {
  const current = { bg: true, agm: true, dmf: true, stv: true };
  assert.deepEqual(mergeTimers(current, 'agm', false), {
    bg: true,
    agm: false,
    dmf: true,
    stv: true
  });
  // Input is not mutated.
  assert.equal(current.agm, true);
});

test('mergeTimers backfills onto a partial (or empty) current map', () => {
  assert.deepEqual(mergeTimers({}, 'stv', true), { stv: true });
  assert.deepEqual(mergeTimers(undefined, 'bg', false), { bg: false });
});

test('mergeTimers coerces the enabled flag to a strict boolean', () => {
  assert.equal(mergeTimers({}, 'dmf', 1).dmf, true);
  assert.equal(mergeTimers({}, 'dmf', 0).dmf, false);
  assert.equal(mergeTimers({}, 'dmf', undefined).dmf, false);
});
