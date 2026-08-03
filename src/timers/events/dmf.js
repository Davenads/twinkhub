import { DateTime } from 'luxon';
import { MT_ZONE, asDateTime, mod } from '../../lib/time.js';

/**
 * Darkmoon Faire — Classic Era schedule (per NovaWorldBuffs `Modules/DMF.lua`).
 *
 * Construction begins the first Friday of the month; the faire itself *opens*
 * `dayOffset` days later at the regional weekly reset. US realms use
 * `dayOffset = 2` → it opens the following **Sunday** and runs 7 full days.
 * (The prior port opened the first Monday, which is wrong for Era.) Open time
 * is taken as 02:00 Mountain, within the real US reset band (~1–5am MT across
 * east/west realms and DST) and unambiguously on the Sunday.
 */
const OPEN_HOUR_MT = 2; // ~US weekly reset, Mountain
const US_DAY_OFFSET = 2; // first Friday -> Sunday

/** First-Friday + 2 days (Sunday) at 02:00 Mountain (MT DateTime). */
function dmfStart(year, month) {
  const firstOfMonth = DateTime.fromObject(
    { year, month, day: 1, hour: 0, minute: 0, second: 0, millisecond: 0 },
    { zone: MT_ZONE }
  );
  // luxon weekday Mon=1..Sun=7, so Friday=5. days-until-Friday, 0 if the 1st is
  // already Friday.
  const daysUntilFri = mod(5 - firstOfMonth.weekday, 7);
  return firstOfMonth
    .plus({ days: daysUntilFri + US_DAY_OFFSET })
    .set({ hour: OPEN_HOUR_MT, minute: 0, second: 0, millisecond: 0 });
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
