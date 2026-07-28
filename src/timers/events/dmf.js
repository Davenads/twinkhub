import { DateTime } from 'luxon';
import { MT_ZONE, asDateTime, mod } from '../../lib/time.js';

/**
 * Darkmoon Faire. Port of `get_dmf_state` / `_dmf_start` from
 * wow-timers/shared.py.
 *
 * Runs the first full week of each month: opens the first Monday on or after the
 * 1st at 00:01 Mountain, and lasts 7 days.
 */

/** First Monday on or after the 1st of the month at 00:01 Mountain (MT DateTime). */
function dmfStart(year, month) {
  const firstOfMonth = DateTime.fromObject(
    { year, month, day: 1, hour: 0, minute: 0, second: 0, millisecond: 0 },
    { zone: MT_ZONE }
  );
  // luxon weekday Mon=1..Sun=7; Python used Mon=0. days-until-Monday, 0 if the
  // 1st is already Monday.
  const daysUntilMon = mod(8 - firstOfMonth.weekday, 7);
  return firstOfMonth.plus({ days: daysUntilMon }).set({ hour: 0, minute: 1, second: 0, millisecond: 0 });
}

export function getState(now) {
  now = asDateTime(now);
  const mt = now.setZone(MT_ZONE);
  const nowMs = now.toMillis();

  // Check this month and next — one of these always resolves the state.
  const months = [
    { year: mt.year, month: mt.month },
    mt.month === 12 ? { year: mt.year + 1, month: 1 } : { year: mt.year, month: mt.month + 1 }
  ];

  for (const { year, month } of months) {
    const start = dmfStart(year, month);
    const end = start.plus({ days: 7 });
    const sMs = start.toMillis();
    const eMs = end.toMillis();
    if (sMs <= nowMs && nowMs < eMs) {
      return { active: true, startsInMs: 0, endsInMs: eMs - nowMs, label: 'DMF', meta: {} };
    }
    if (nowMs < sMs) {
      return { active: false, startsInMs: sMs - nowMs, endsInMs: 0, label: 'DMF', meta: {} };
    }
  }

  // Defensive fallback (the loop above always returns at "next month"; this only
  // guards against an unforeseen edge). Month-after-next, wrapping the year.
  const total = mt.month + 2;
  const fbYear = total > 12 ? mt.year + 1 : mt.year;
  const fbMonth = total > 12 ? total - 12 : total;
  const sMs = dmfStart(fbYear, fbMonth).toMillis();
  return { active: false, startsInMs: sMs - nowMs, endsInMs: 0, label: 'DMF', meta: {} };
}
