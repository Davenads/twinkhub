import * as bg from './bg.js';
import * as agm from './agm.js';
import * as dmf from './dmf.js';
import * as stv from './stv.js';

/**
 * Registry of tracked events, keyed by the config-facing event key
 * (matches `config.timers.<key>` and the `/alerts` / `/testevent` choices).
 * Each module exposes a pure `getState(now)` returning the normalized shape:
 *   { active, startsInMs, endsInMs, label, meta }
 */
export const EVENTS = { bg, agm, dmf, stv };

export const EVENT_KEYS = Object.keys(EVENTS);

/** Compute every event's state for a single `now`. */
export function getAllStates(now) {
  const out = {};
  for (const key of EVENT_KEYS) out[key] = EVENTS[key].getState(now);
  return out;
}
