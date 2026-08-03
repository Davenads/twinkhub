import { MT_ZONE, asDateTime, mod } from '../../lib/time.js';

/**
 * Arena Grand Master (Gurubashi Arena chest). Port of `get_agm_state` from
 * wow-timers/shared.py, corrected for the true in-game spawn phase.
 *
 * Chest spawns every 3 hours at 01:00, 04:00, 07:00, … 22:00 Mountain — one
 * hour past the naive midnight-aligned slots the original port used (it fired
 * an hour early). `AGM_PHASE_MS` shifts the slot boundary by that hour; the
 * euclidean `mod` handles the sub-1h wrap. Each spawn has a ~5-minute active
 * window. Computed purely from the wall-clock time-of-day in MT, so it inherits
 * the same DST behavior as the Python source.
 */
const CHEST_INTERVAL_MS = 3 * 60 * 60 * 1000; // 3 hours
const CHEST_WINDOW_MS = 5 * 60 * 1000; // 5-minute active window
const AGM_PHASE_MS = 60 * 60 * 1000; // spawns are offset +1h (01:00, 04:00, …)

export function getState(now) {
  now = asDateTime(now);
  const mt = now.setZone(MT_ZONE);
  // Whole-second precision only (drops sub-second), matching the Python port.
  const msIntoDay = (mt.hour * 3600 + mt.minute * 60 + mt.second) * 1000;
  const slotMs = mod(msIntoDay - AGM_PHASE_MS, CHEST_INTERVAL_MS);
  const isUp = slotMs < CHEST_WINDOW_MS;
  const msUntilNext = CHEST_INTERVAL_MS - slotMs;
  const msWindowLeft = Math.max(0, CHEST_WINDOW_MS - slotMs);

  return {
    active: isUp,
    startsInMs: isUp ? 0 : msUntilNext,
    endsInMs: isUp ? msWindowLeft : 0,
    label: 'AGM',
    // msUntilNext is preserved even while up (time to the *next* spawn); the
    // 10-min advance-warning latch reads it in the tick engine.
    meta: { isUp, msUntilNext, msWindowLeft }
  };
}
