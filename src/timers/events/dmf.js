import { DateTime } from 'luxon';
import { REALM_ZONE, asDateTime, mod } from '../../lib/time.js';

/**
 * Darkmoon Faire — Classic Era schedule (per NovaWorldBuffs `Modules/DMF.lua`).
 *
 * Construction begins the first Friday of the month; the faire itself *opens*
 * `dayOffset` days later at the regional weekly reset. US realms use
 * `dayOffset = 2` → it opens the following **Sunday** and runs 7 full days.
 * (The prior port opened the first Monday, which is wrong for Era.) Open time
 * is taken as 02:00 Pacific, within the real US reset band (~1–5am PT across
 * east/west realms and DST) and unambiguously on the Sunday.
 */
const OPEN_HOUR_REALM = 2; // ~US weekly reset, Pacific
const US_DAY_OFFSET = 2; // first Friday -> Sunday

// Classic Era 2-zone rotation. Anniversary/TBC uses a 3-zone (Outlands/Elwynn/
// Mulgore) table and SoD a weeks-anchored one, but Era only ever alternates
// Elwynn Forest <-> Mulgore. No Terokkar/Outlands on Era.
const DMF_ZONES = {
  elwynn: { name: 'Elwynn Forest', short: 'Elwynn' },
  mulgore: { name: 'Mulgore', short: 'Mulgore' }
};

/**
 * Zone for a given faire, per NovaWorldBuffs `DMF.lua` isClassic branch: pick by
 * the open month's parity — odd -> Elwynn Forest, even -> Mulgore. NWB bumps the
 * month when the faire opens after the 20th; our US open is always the first
 * Sunday (day <= 9) so that edge never fires, but we mirror it for fidelity.
 *
 * @param {import('luxon').DateTime} start faire open in Pacific time
 */
function dmfLocation(start) {
  let month = start.month;
  if (start.day > 20) month = month === 12 ? 1 : month + 1;
  return month % 2 === 0 ? DMF_ZONES.mulgore : DMF_ZONES.elwynn;
}

/** First-Friday + 2 days (Sunday) at 02:00 Pacific (realm DateTime). */
function dmfStart(year, month) {
  const firstOfMonth = DateTime.fromObject(
    { year, month, day: 1, hour: 0, minute: 0, second: 0, millisecond: 0 },
    { zone: REALM_ZONE }
  );
  // luxon weekday Mon=1..Sun=7, so Friday=5. days-until-Friday, 0 if the 1st is
  // already Friday.
  const daysUntilFri = mod(5 - firstOfMonth.weekday, 7);
  return firstOfMonth
    .plus({ days: daysUntilFri + US_DAY_OFFSET })
    .set({ hour: OPEN_HOUR_REALM, minute: 0, second: 0, millisecond: 0 });
}

export function getState(now) {
  now = asDateTime(now);
  const realm = now.setZone(REALM_ZONE);
  const nowMs = now.toMillis();

  // Check this month and next — one of these always resolves the state.
  const months = [
    { year: realm.year, month: realm.month },
    realm.month === 12
      ? { year: realm.year + 1, month: 1 }
      : { year: realm.year, month: realm.month + 1 }
  ];

  for (const { year, month } of months) {
    const start = dmfStart(year, month);
    const end = start.plus({ days: 7 });
    const sMs = start.toMillis();
    const eMs = end.toMillis();
    const location = dmfLocation(start);
    if (sMs <= nowMs && nowMs < eMs) {
      return {
        active: true,
        startsInMs: 0,
        endsInMs: eMs - nowMs,
        label: 'DMF',
        meta: { location }
      };
    }
    if (nowMs < sMs) {
      return {
        active: false,
        startsInMs: sMs - nowMs,
        endsInMs: 0,
        label: 'DMF',
        meta: { location }
      };
    }
  }

  // Defensive fallback (the loop above always returns at "next month"; this only
  // guards against an unforeseen edge). Month-after-next, wrapping the year.
  const total = realm.month + 2;
  const fbYear = total > 12 ? realm.year + 1 : realm.year;
  const fbMonth = total > 12 ? total - 12 : total;
  const fbStart = dmfStart(fbYear, fbMonth);
  const sMs = fbStart.toMillis();
  return {
    active: false,
    startsInMs: sMs - nowMs,
    endsInMs: 0,
    label: 'DMF',
    meta: { location: dmfLocation(fbStart) }
  };
}
