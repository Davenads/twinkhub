import test from 'node:test';
import assert from 'node:assert/strict';
import { DateTime } from 'luxon';
import { EVENTS, EVENT_KEYS, getAllStates } from '../../src/timers/events/index.js';
import { BATTLEGROUNDS } from '../../src/timers/events/bg.js';

const STATIC_LABEL = { agm: 'AGM', dmf: 'DMF', stv: 'STV' };
const NOW = DateTime.utc(2026, 4, 6, 6, 1, 0); // an instant where every event has data

test('EVENT_KEYS is the four consolidated events', () => {
  assert.deepEqual(EVENT_KEYS, ['bg', 'agm', 'dmf', 'stv']);
});

test('getAllStates returns one state per event key', () => {
  const all = getAllStates(NOW);
  assert.deepEqual(Object.keys(all).sort(), [...EVENT_KEYS].sort());
});

for (const key of EVENT_KEYS) {
  test(`${key}.getState returns the normalized shape`, () => {
    const s = EVENTS[key].getState(NOW);
    assert.equal(typeof s.active, 'boolean');
    assert.equal(typeof s.startsInMs, 'number');
    assert.equal(typeof s.endsInMs, 'number');
    assert.ok(s.startsInMs >= 0, 'startsInMs is non-negative');
    assert.ok(s.endsInMs >= 0, 'endsInMs is non-negative');
    assert.equal(typeof s.label, 'string');
    assert.ok(s.label.length > 0);
    assert.equal(typeof s.meta, 'object');
    assert.notEqual(s.meta, null);
    // Invariant shared by every event: when active, there is no "starts in".
    if (s.active) assert.equal(s.startsInMs, 0, `${key} startsInMs is 0 while active`);
  });
}

test('non-BG events carry their static label', () => {
  for (const [key, label] of Object.entries(STATIC_LABEL)) {
    assert.equal(EVENTS[key].getState(NOW).label, label);
  }
});

test('BG label is always a real rotation short name', () => {
  const names = BATTLEGROUNDS.map((b) => b.shortName);
  // sample a full rotation cycle of weeks
  for (let w = 0; w < 8; w++) {
    const now = DateTime.utc(2026, 3, 24, 8, 0, 0).plus({ weeks: w });
    assert.ok(names.includes(EVENTS.bg.getState(now).label));
  }
});
