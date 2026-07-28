import test from 'node:test';
import assert from 'node:assert/strict';
import { DateTime } from 'luxon';
import { MT_ZONE, mod, asDateTime, formatCountdown, risingEdge } from '../../src/lib/time.js';

test('MT_ZONE is Mountain', () => {
  assert.equal(MT_ZONE, 'America/Denver');
});

test('mod is Euclidean (non-negative for positive m)', () => {
  assert.equal(mod(0, 7), 0);
  assert.equal(mod(7, 7), 0);
  assert.equal(mod(8, 7), 1);
  assert.equal(mod(-1, 7), 6);
  assert.equal(mod(-2, 4), 2);
});

test('formatCountdown ports shared.py exactly', () => {
  assert.equal(formatCountdown(0), 'now');
  assert.equal(formatCountdown(-5), 'now');
  assert.equal(formatCountdown(60000), '1m');
  assert.equal(formatCountdown(90000), '1m'); // floors seconds
  assert.equal(formatCountdown(300000), '5m');
  assert.equal(formatCountdown(3600000), '1h 0m');
  assert.equal(formatCountdown(3661000), '1h 1m'); // 1h 1m 1s -> seconds floored
  assert.equal(formatCountdown(172800000), '2d 0m');
  assert.equal(formatCountdown(93784000), '1d 2h 3m');
});

test('risingEdge fires only on false -> true', () => {
  assert.equal(risingEdge(false, true), true);
  assert.equal(risingEdge(true, true), false);
  assert.equal(risingEdge(false, false), false);
  assert.equal(risingEdge(true, false), false);
  // prev must be exactly false (not merely falsy) so the first-ever tick (null)
  // doesn't count as an edge.
  assert.equal(risingEdge(null, true), false);
  assert.equal(risingEdge(undefined, true), false);
});

test('asDateTime coerces every accepted input to the same instant', () => {
  const ms = Date.UTC(2026, 2, 24, 8, 0, 0); // 2026-03-24T08:00:00Z (month is 0-based here)
  const iso = '2026-03-24T08:00:00Z';
  assert.equal(asDateTime(ms).toMillis(), ms);
  assert.equal(asDateTime(new Date(ms)).toMillis(), ms);
  assert.equal(asDateTime(iso).toMillis(), ms);
  const dt = DateTime.fromMillis(ms, { zone: 'utc' });
  assert.equal(asDateTime(dt), dt); // DateTime passes through unchanged
  assert.ok(asDateTime().isValid); // no arg => current instant
});

test('asDateTime rejects unsupported input', () => {
  assert.throws(() => asDateTime({}), TypeError);
});
