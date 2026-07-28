import { getAllStates } from './events/index.js';
import { computeTriggers, DELIVERY } from './triggers.js';
import { loadLatches, saveLatches } from './latchStore.js';
import { asDateTime } from '../lib/time.js';

/**
 * Run one timer tick.
 *
 * Sequence: compute all event states for `now`, resolve edge/warning triggers
 * against the persisted latches, **persist the new latches before dispatching**
 * (so a crash mid-fan-out can never respawn the same ping), then hand each fire
 * to `dispatch` along with its delivery policy and the event's state snapshot.
 *
 * The engine performs no Discord side effects itself — `dispatch` owns the
 * guild fan-out (ping / broadcast / DM). This keeps the tick loop unit-testable
 * with an in-memory store and a mock dispatch.
 *
 * @param {object} opts
 * @param {number|Date|import('luxon').DateTime|string} [opts.now] - current time.
 * @param {(fire: {event:string,kind:string,policy:object,state:object}) => Promise<void>} opts.dispatch
 * @param {{ load: () => Promise<object>, save: (l:object) => Promise<void> }} [opts.store]
 * @returns {Promise<{ fires: object[], states: object, latches: object }>}
 */
export async function runTimerEngine({ now, dispatch, store } = {}) {
  const dt = asDateTime(now);
  const nowMs = dt.toMillis();
  const states = getAllStates(dt);

  const load = store?.load ?? loadLatches;
  const save = store?.save ?? saveLatches;

  const prev = await load();
  const { fires, latches } = computeTriggers(states, prev, nowMs);

  // Persist first: a crash after this point must not re-fire on restart.
  await save(latches);

  for (const fire of fires) {
    const policy = DELIVERY[fire.event]?.[fire.kind];
    if (!policy) continue; // e.g. bg/dmf have no 'warning' kind
    await dispatch({ ...fire, policy, state: states[fire.event] });
  }

  return { fires, states, latches };
}
