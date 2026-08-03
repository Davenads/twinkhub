import { DateTime } from 'luxon';
import { MT_ZONE, asDateTime, mod } from '../../lib/time.js';

/**
 * BG Weekend rotation. Port of `get_rotation_info` / `_bg_week_start` from
 * wow-timers/shared.py, corrected for Classic Era.
 *
 * Classic Era has only three Call to Arms battlegrounds — AV, WSG, AB (Eye of
 * the Storm is a TBC BG and never rotates in Era). The cycle advances each
 * Tuesday 2:00 AM Mountain: AV -> WSG -> AB -> AV. The weekend itself runs
 * Thursday 2am MT -> the following Tuesday 2am MT.
 */
export const BATTLEGROUNDS = [
  { name: 'Alterac Valley', shortName: 'AV' },
  { name: 'Warsong Gulch', shortName: 'WSG' },
  { name: 'Arathi Basin', shortName: 'AB' }
];

/** Anchor: Tuesday 2026-07-28 02:00 MDT = 08:00 UTC — the confirmed AB week
 *  whose weekend fell on Aug 1–2 2026. ANCHOR_INDEX pins that week to AB (2);
 *  the rotation index derives from whole weeks elapsed since this instant. */
export const BG_ANCHOR = DateTime.utc(2026, 7, 28, 8, 0, 0);
const ANCHOR_INDEX = 2; // BATTLEGROUNDS[2] === AB

const WEEK_MS = 7 * 24 * 3600 * 1000;

/** Most recent Tuesday 2:00 AM Mountain Time at or before `now` (returned UTC). */
function bgWeekStart(now) {
  const nowMt = now.setZone(MT_ZONE);
  // luxon weekday: Mon=1 ... Sun=7, so Tue=2. Python used Mon=0..Tue=1.
  const daysSinceTue = mod(nowMt.weekday - 2, 7);
  const tueCal = nowMt.minus({ days: daysSinceTue });
  const tuesday2am = (cal) =>
    DateTime.fromObject(
      { year: cal.year, month: cal.month, day: cal.day, hour: 2, minute: 0, second: 0, millisecond: 0 },
      { zone: MT_ZONE }
    );
  let start = tuesday2am(tueCal);
  if (start.toMillis() > now.toMillis()) {
    // Today is Tuesday but still before 2 AM — step back one week.
    start = tuesday2am(tueCal.minus({ days: 7 }));
  }
  return start.toUTC();
}

/**
 * getState(now) -> normalized event state.
 * meta carries the BG-specific rotation extras (current/next BG, index).
 */
export function getState(now) {
  now = asDateTime(now);
  const weekStart = bgWeekStart(now);
  const weekendStart = weekStart.plus({ days: 2 }); // Thu 2am MT ≈ +48h (UTC math)
  const weekEnd = weekStart.plus({ days: 7 });

  const weeks = Math.round((weekStart.toMillis() - BG_ANCHOR.toMillis()) / WEEK_MS);
  const bgIdx = mod(weeks + ANCHOR_INDEX, BATTLEGROUNDS.length);
  const nextIdx = mod(bgIdx + 1, BATTLEGROUNDS.length);

  const nowMs = now.toMillis();
  const wsMs = weekendStart.toMillis();
  const weMs = weekEnd.toMillis();
  const active = wsMs <= nowMs && nowMs < weMs;

  return {
    active,
    startsInMs: Math.max(0, wsMs - nowMs),
    endsInMs: Math.max(0, weMs - nowMs),
    label: BATTLEGROUNDS[bgIdx].shortName,
    meta: {
      currentBG: BATTLEGROUNDS[bgIdx],
      nextBG: BATTLEGROUNDS[nextIdx],
      rotationIndex: bgIdx,
      weeksSinceAnchor: weeks
    }
  };
}
