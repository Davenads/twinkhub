import test from 'node:test';
import assert from 'node:assert/strict';
import { DateTime } from 'luxon';
import { getState } from '../../src/timers/events/dmf.js';

/**
 * Classic Era 2-zone rotation (NovaWorldBuffs `DMF.lua` isClassic branch): the
 * faire's open-month parity picks the zone — odd -> Elwynn Forest, even ->
 * Mulgore. No Terokkar/Outlands on Era. First Sunday open means startDay <= 9,
 * so NWB's ">20 bump" never applies here.
 */
const at = (iso) => DateTime.fromISO(iso, { zone: 'utc' });

test('DMF Era zone: even open-month -> Mulgore', () => {
  // Aug 2026 faire opens Sun Aug 9; month 8 is even.
  const s = getState(at('2026-08-01T12:00:00'));
  assert.deepEqual(s.meta.location, { name: 'Mulgore', short: 'Mulgore' });
});

test('DMF Era zone: odd open-month -> Elwynn Forest', () => {
  // Sep 2026 faire opens Sun Sep 6; month 9 is odd.
  const s = getState(at('2026-09-01T12:00:00'));
  assert.deepEqual(s.meta.location, { name: 'Elwynn Forest', short: 'Elwynn' });
});

test('DMF Era zone rides the active faire', () => {
  // Inside the Aug 2026 window (opens Aug 9 02:00 PT).
  const s = getState(at('2026-08-11T12:00:00'));
  assert.equal(s.active, true);
  assert.deepEqual(s.meta.location, { name: 'Mulgore', short: 'Mulgore' });
});
