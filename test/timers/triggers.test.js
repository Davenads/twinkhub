import test from 'node:test';
import assert from 'node:assert/strict';
import { computeTriggers, WARN_MS, DELIVERY } from '../../src/timers/triggers.js';
import { EVENT_KEYS } from '../../src/timers/events/index.js';

const MIN = 60 * 1000;
const T = Date.UTC(2026, 6, 28, 17, 50); // arbitrary fixed instant

/** Build a states map where every event is idle & far away, with overrides. */
function idleStates(overrides = {}) {
  const base = {};
  for (const k of EVENT_KEYS) {
    base[k] = { active: false, startsInMs: 9e12, endsInMs: 0, label: k, meta: {} };
  }
  return { ...base, ...overrides };
}

test('seed adopts current reality and fires nothing', () => {
  const active = idleStates({
    bg: { active: true, startsInMs: 0, endsInMs: 1000, label: 'AV', meta: {} }
  });
  const r = computeTriggers(active, {}, T);
  assert.deepEqual(r.fires, []); // cold start during active => no retro-fire
  assert.equal(r.latches.bg.wasActive, true);
  for (const k of EVENT_KEYS) assert.ok(k in r.latches);
});

test('occurrence fires once on false->true, then never while active', () => {
  const active = idleStates({
    bg: { active: true, startsInMs: 0, endsInMs: 1000, label: 'AV', meta: {} }
  });

  let r = computeTriggers(idleStates(), {}, T); // seed all idle
  assert.deepEqual(r.fires, []);

  r = computeTriggers(active, r.latches, T); // false -> true
  assert.deepEqual(r.fires, [{ event: 'bg', kind: 'occurrence' }]);

  r = computeTriggers(active, r.latches, T + MIN); // still active
  assert.deepEqual(r.fires, []);

  // Simulated restart: reuse the persisted latch while still active.
  r = computeTriggers(active, r.latches, T + 2 * MIN);
  assert.deepEqual(r.fires, []); // restart-safe: no re-fire
});

test('warning fires once per upcoming start instant and re-arms next cycle', () => {
  const warn = idleStates({
    agm: { active: false, startsInMs: 10 * MIN, endsInMs: 0, label: 'AGM', meta: {} }
  });

  let r = computeTriggers(idleStates(), {}, T); // seed: agm far away
  assert.deepEqual(r.fires, []);

  r = computeTriggers(warn, r.latches, T); // enters 10-min window
  assert.deepEqual(r.fires, [{ event: 'agm', kind: 'warning' }]);

  // One minute later, same upcoming start instant (T + 10min) => no re-fire.
  const warn2 = idleStates({
    agm: { active: false, startsInMs: 9 * MIN, endsInMs: 0, label: 'AGM', meta: {} }
  });
  r = computeTriggers(warn2, r.latches, T + MIN);
  assert.deepEqual(r.fires, []);

  // Next occurrence 3h later: different start instant => warning re-arms.
  const later = T + 3 * 60 * MIN;
  const warnNext = idleStates({
    agm: { active: false, startsInMs: 10 * MIN, endsInMs: 0, label: 'AGM', meta: {} }
  });
  r = computeTriggers(warnNext, r.latches, later);
  assert.deepEqual(r.fires, [{ event: 'agm', kind: 'warning' }]);
});

test('warning latch survives a mid-window restart (no double-ping)', () => {
  const warn = idleStates({
    stv: { active: false, startsInMs: 30 * MIN, endsInMs: 0, label: 'STV', meta: {} }
  });

  let r = computeTriggers(idleStates(), {}, T);
  r = computeTriggers(warn, r.latches, T); // fires warning
  assert.deepEqual(r.fires, [{ event: 'stv', kind: 'warning' }]);

  // "Restart" mid-window: feed the persisted latch back in with a later now
  // still pointing at the same start instant (T + 30min).
  const warnLater = idleStates({
    stv: { active: false, startsInMs: 25 * MIN, endsInMs: 0, label: 'STV', meta: {} }
  });
  r = computeTriggers(warnLater, r.latches, T + 5 * MIN);
  assert.deepEqual(r.fires, []);
});

test('events with no advance warning (bg, dmf) never fire a warning', () => {
  for (const k of ['bg', 'dmf']) {
    assert.equal(WARN_MS[k], 0);
    const soon = idleStates({
      [k]: { active: false, startsInMs: 5 * MIN, endsInMs: 0, label: k, meta: {} }
    });
    let r = computeTriggers(idleStates(), {}, T);
    r = computeTriggers(soon, r.latches, T);
    assert.deepEqual(r.fires, []); // no warning kind for occurrence-only events
  }
});

test('delivery policy matches the plan (AGM spawn silent AND dm-free)', () => {
  assert.deepEqual(DELIVERY.bg.occurrence, { channel: 'ping', dm: true });
  assert.deepEqual(DELIVERY.dmf.occurrence, { channel: 'ping', dm: true });
  assert.deepEqual(DELIVERY.agm.warning, { channel: 'ping', dm: true });
  assert.deepEqual(DELIVERY.agm.occurrence, { channel: 'broadcast', dm: false });
  assert.deepEqual(DELIVERY.stv.warning, { channel: 'ping', dm: true });
  assert.deepEqual(DELIVERY.stv.occurrence, { channel: 'broadcast', dm: true });
  // Occurrence-only events have no warning policy at all.
  assert.equal(DELIVERY.bg.warning, undefined);
  assert.equal(DELIVERY.dmf.warning, undefined);
});
