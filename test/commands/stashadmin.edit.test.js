import { test } from 'node:test';
import assert from 'node:assert/strict';
import { collisionNote } from '../../src/commands/admin/stashadmin.js';

test('collisionNote returns null when no other item matches', () => {
  assert.equal(collisionNote('itm_a', []), null);
  assert.equal(collisionNote('itm_a', [{ id: 'itm_a', name: 'Self' }]), null);
});

test('collisionNote names a different-id match', () => {
  const note = collisionNote('itm_a', [
    { id: 'itm_a', name: 'Self' },
    { id: 'itm_b', name: 'Other' }
  ]);
  assert.match(note, /itm_b/);
  assert.match(note, /Other/);
  assert.match(note, /consolidat/i);
});

test('collisionNote tolerates null/non-array input', () => {
  assert.equal(collisionNote('itm_a', null), null);
  assert.equal(collisionNote('itm_a', undefined), null);
  assert.equal(collisionNote('itm_a', 'nope'), null);
});
