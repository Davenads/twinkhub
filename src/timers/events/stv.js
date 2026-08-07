import { DateTime } from 'luxon';
import { MT_ZONE, asDateTime, mod } from '../../lib/time.js';

/**
 * STV Fishing Extravaganza. Port of `get_stv_state` from
 * wow-timers/shared.py.
 *
 * Runs every Sunday 2:00 PM – 4:00 PM Mountain.
 */
export function getState(now) {
  now = asDateTime(now);
  const mt = now.setZone(MT_ZONE);
  const nowMs = now.toMillis();

  // luxon weekday Mon=1..Sun=7; Sun -> 0 days back. Python used (weekday+1)%7.
  const daysSinceSun = mod(mt.weekday, 7);
  const sundayCal = mt.minus({ days: daysSinceSun });
  const atMt = (hour) =>
    DateTime.fromObject(
      {
        year: sundayCal.year,
        month: sundayCal.month,
        day: sundayCal.day,
        hour,
        minute: 0,
        second: 0,
        millisecond: 0
      },
      { zone: MT_ZONE }
    );

  const thisStart = atMt(14);
  const thisEnd = atMt(16);
  const nextStart = thisStart.plus({ days: 7 });

  const tsMs = thisStart.toMillis();
  const teMs = thisEnd.toMillis();
  const nsMs = nextStart.toMillis();

  if (tsMs <= nowMs && nowMs < teMs) {
    return { active: true, startsInMs: 0, endsInMs: teMs - nowMs, label: 'STV', meta: {} };
  }
  if (nowMs < tsMs) {
    return { active: false, startsInMs: tsMs - nowMs, endsInMs: 0, label: 'STV', meta: {} };
  }
  return { active: false, startsInMs: nsMs - nowMs, endsInMs: 0, label: 'STV', meta: {} };
}
