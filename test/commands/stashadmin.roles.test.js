import { test } from 'node:test';
import assert from 'node:assert/strict';
import { addRoleId, removeRoleId } from '../../src/commands/admin/stashadmin.js';

test('addRoleId appends a new id', () => {
  assert.deepEqual(addRoleId(['a'], 'b'), ['a', 'b']);
});

test('addRoleId dedupes an existing id', () => {
  assert.deepEqual(addRoleId(['a', 'b'], 'a'), ['a', 'b']);
});

test('addRoleId tolerates null/undefined and non-array input', () => {
  assert.deepEqual(addRoleId(null, 'a'), ['a']);
  assert.deepEqual(addRoleId(undefined, 'a'), ['a']);
  assert.deepEqual(addRoleId('nope', 'a'), ['a']);
});

test('addRoleId strips falsy entries from the existing list', () => {
  assert.deepEqual(addRoleId(['a', '', null], 'b'), ['a', 'b']);
});

test('removeRoleId drops the id and leaves the rest', () => {
  assert.deepEqual(removeRoleId(['a', 'b', 'c'], 'b'), ['a', 'c']);
});

test('removeRoleId is a no-op when the id is absent', () => {
  assert.deepEqual(removeRoleId(['a'], 'b'), ['a']);
});

test('removeRoleId tolerates null/absent input', () => {
  assert.deepEqual(removeRoleId(null, 'a'), []);
  assert.deepEqual(removeRoleId(undefined, 'a'), []);
});
