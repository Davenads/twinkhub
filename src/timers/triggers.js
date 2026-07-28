import { EVENT_KEYS } from './events/index.js';

const MIN_MS = 60 * 1000;

/**
 * Advance-warning lead time per event. `0` means the event has no advance
 * warning and fires on its occurrence only (BG go-live, DMF open).
 */
export const WARN_MS = {
  bg: 0,
  dmf: 0,
  agm: 10 * MIN_MS,
  stv: 30 * MIN_MS
};

/**
 * Delivery policy per event + trigger kind: which channel mode to use and
 * whether to DM-fan-out. Mirrors plans/02-timers-module.md verbatim, including
 * the one asymmetry to preserve: AGM's spawn is BOTH silent (`broadcast`) AND
 * DM-free; only its 10-min warning DMs. Events with no `warning` key never
 * fire an advance ping.
 */
export const DELIVERY = {
  bg: { occurrence: { channel: 'ping', dm: true } },
  dmf: { occurrence: { channel: 'ping', dm: true } },
  agm: {
    warning: { channel: 'ping', dm: true },
    occurrence: { channel: 'broadcast', dm: false }
  },
  stv: {
    warning: { channel: 'ping', dm: true },
    occurrence: { channel: 'broadcast', dm: true }
  }
};

function roundMinute(ms) {
  return Math.round(ms / MIN_MS) * MIN_MS;
}

/**
 * Pure edge/latch resolver. Given the current computed states (from
 * `getAllStates(now)`), the persisted latch map, and the current time in ms,
 * decide which triggers fire this tick and return the next latch map.
 *
 * Latch per event: `{ wasActive: boolean, warnedStartMs: number|null }`.
 *
 * Correctness properties (see plans/02 "Edge detection & latches"):
 * - **Occurrence** fires only on the `active` false -> true transition.
 * - **Advance warning** fires once per distinct upcoming start instant. The
 *   latch key is the absolute next-start instant (`now + startsInMs`) rounded
 *   to the minute, so it survives a mid-window restart (no double-ping) and
 *   auto-rearms when the next occurrence's start instant differs.
 * - An **unseen event is seeded** from current reality and fires nothing, so a
 *   cold start / fresh latch file never retro-fires an already-active event or
 *   an already-open warning window (matches the Python `was_active`-on-boot).
 *
 * @param {Record<string, {active:boolean,startsInMs:number}>} states
 * @param {Record<string, {wasActive:boolean,warnedStartMs:number|null}>} latches
 * @param {number} nowMs
 * @returns {{ fires: {event:string,kind:'occurrence'|'warning'}[], latches: object }}
 */
export function computeTriggers(states, latches = {}, nowMs) {
  const fires = [];
  const next = {};

  for (const key of EVENT_KEYS) {
    const s = states[key];
    const warnMs = WARN_MS[key] ?? 0;
    const inWarn =
      warnMs > 0 && !s.active && s.startsInMs > 0 && s.startsInMs <= warnMs;
    const startKey = inWarn ? roundMinute(nowMs + s.startsInMs) : null;

    const prev = latches[key];
    if (!prev) {
      // Seed: adopt current reality, fire nothing.
      next[key] = { wasActive: s.active, warnedStartMs: startKey };
      continue;
    }

    let { wasActive, warnedStartMs } = prev;

    // Occurrence edge: false -> true.
    if (s.active && !wasActive) {
      fires.push({ event: key, kind: 'occurrence' });
    }

    // Advance warning: once per distinct upcoming start instant.
    if (inWarn && warnedStartMs !== startKey) {
      fires.push({ event: key, kind: 'warning' });
      warnedStartMs = startKey;
    }

    next[key] = { wasActive: s.active, warnedStartMs };
  }

  return { fires, latches: next };
}
