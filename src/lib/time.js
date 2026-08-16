import { DateTime } from 'luxon';

/**
 * Realm time — the zone every in-game event schedule is computed in (DST-safe
 * via the IANA database). TwinkHub tracks the Whitemane connected-realm cluster
 * (NA "PvP West"), whose in-game events fire on US Pacific time. The upstream
 * wow-timers port used `America/Denver` (Mountain) for Anniversary realms; on
 * Whitemane that fired every timer one hour early, so Era uses Pacific.
 */
export const REALM_ZONE = 'America/Los_Angeles';

/** Euclidean modulo — always returns a non-negative result for positive `m`,
 *  matching Python's `%` (JS `%` keeps the sign of the dividend). Needed so the
 *  weekday math in the event ports behaves like the Python source. */
export function mod(n, m) {
  return ((n % m) + m) % m;
}

/**
 * Coerce whatever a caller passes as `now` into a luxon DateTime.
 * Accepts a DateTime (returned as-is), a JS Date, epoch millis, an ISO string,
 * or nothing (=> current instant in UTC). Keeps every `getState(now)` pure and
 * `now`-injectable so the schedule logic is unit-testable without real time.
 */
export function asDateTime(now) {
  if (now == null) return DateTime.utc();
  if (DateTime.isDateTime(now)) return now;
  if (now instanceof Date) return DateTime.fromJSDate(now);
  if (typeof now === 'number') return DateTime.fromMillis(now);
  if (typeof now === 'string') return DateTime.fromISO(now, { zone: 'utc' });
  throw new TypeError('asDateTime: unsupported `now` value');
}

/**
 * Human countdown from a millisecond duration. Verbatim port of
 * `format_countdown` in shared.py: floors to whole minutes, drops leading zero
 * units, always shows minutes, and returns "now" for non-positive input.
 *   e.g. 93_784_000 -> "1d 2h 3m", 3_600_000 -> "1h 0m", 0 -> "now"
 */
export function formatCountdown(ms) {
  if (ms <= 0) return 'now';
  let s = Math.floor(ms / 1000);
  const d = Math.floor(s / 86400);
  s -= d * 86400;
  const h = Math.floor(s / 3600);
  s -= h * 3600;
  const m = Math.floor(s / 60);
  const parts = [];
  if (d) parts.push(`${d}d`);
  if (h) parts.push(`${h}h`);
  parts.push(`${m}m`);
  return parts.join(' ');
}

/**
 * Pure rising-edge test: true only on a false -> true transition. This is the
 * primitive behind the occurrence-edge detection (`was_active` / `was_up` in the
 * Python bots) — fire once when an event goes live, not every tick while active.
 * The tick engine (P1) owns the persisted previous-state; this stays pure.
 */
export function risingEdge(prev, curr) {
  return prev === false && curr === true;
}
