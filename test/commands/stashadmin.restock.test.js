import { test } from 'node:test';
import assert from 'node:assert/strict';
import { pickRestockTarget } from '../../src/services/stash.js';

test('pickRestockTarget returns the earliest match when not forcing new', () => {
  const matches = [{ id: 'a' }, { id: 'b' }];
  assert.deepEqual(pickRestockTarget(matches, false), { id: 'a' });
});

test('pickRestockTarget returns null when force_new is set', () => {
  assert.equal(pickRestockTarget([{ id: 'a' }], true), null);
});

test('pickRestockTarget returns null with no matches', () => {
  assert.equal(pickRestockTarget([], false), null);
});

test('pickRestockTarget tolerates null/non-array input', () => {
  assert.equal(pickRestockTarget(null, false), null);
  assert.equal(pickRestockTarget(undefined, false), null);
  assert.equal(pickRestockTarget('nope', false), null);
});
