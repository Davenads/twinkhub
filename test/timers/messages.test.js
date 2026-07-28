import test from 'node:test';
import assert from 'node:assert/strict';
import { renderMessage } from '../../src/timers/messages.js';

// Expected strings use the same \u escapes as src/timers/messages.js so the
// comparison is byte-identical regardless of file encoding.

test('AGM warning + spawn copy matches production', () => {
  assert.equal(
    renderMessage('agm', 'warning'),
    '\u2694\uFE0F **Arena Grand Master** chest spawns in 10 minutes!'
  );
  assert.equal(
    renderMessage('agm', 'occurrence'),
    '\u2694\uFE0F **Arena Grand Master** chest has spawned! Grab it fast \u2014 you have 5 minutes!'
  );
});

test('DMF open copy matches production', () => {
  assert.equal(
    renderMessage('dmf', 'occurrence'),
    '\uD83C\uDFAA **Darkmoon Faire** is now open! Head to Elwynn Forest, Mulgore, or Terokkar Forest.'
  );
});

test('STV warning + start copy matches production', () => {
  assert.equal(
    renderMessage('stv', 'warning'),
    '\uD83C\uDFA3 **STV Fishing Extravaganza** starts in 30 minutes! Bring your rods to Stranglethorn Vale!'
  );
  assert.equal(
    renderMessage('stv', 'occurrence'),
    '\uD83C\uDFA3 **STV Fishing Extravaganza** has started! Head to Stranglethorn Vale \u2014 you have 2 hours!'
  );
});

test('BG live copy uses rotation short-name + active countdown', () => {
  const state = {
    endsInMs: 90 * 60 * 1000,
    label: 'WSG',
    meta: { currentBG: { name: 'Warsong Gulch', shortName: 'WSG' } }
  };
  assert.equal(
    renderMessage('bg', 'occurrence', state),
    '\uD83C\uDFDF\uFE0F **WSG Weekend** is now live! Active for 1h 30m.'
  );
});

test('BG copy falls back to label when meta is absent', () => {
  assert.equal(
    renderMessage('bg', 'occurrence', { endsInMs: 0, label: 'AV' }),
    '\uD83C\uDFDF\uFE0F **AV Weekend** is now live! Active for now.'
  );
});

test('occurrence-only events have no warning; unknown combos are null', () => {
  assert.equal(renderMessage('bg', 'warning'), null);
  assert.equal(renderMessage('dmf', 'warning'), null);
  assert.equal(renderMessage('nope', 'occurrence'), null);
});
