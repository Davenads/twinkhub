import { formatCountdown } from '../lib/time.js';

// Per-trigger alert copy, ported verbatim from the four wow-timers bots so the
// consolidated bot's messages match production exactly (required for the
// side-by-side cutover verification in plans/02). The emoji prefixes are part of
// that production copy — they are message data, not decoration.

const AGM_WARNING = '\u2694\uFE0F **Arena Grand Master** chest spawns in 10 minutes!';
const AGM_SPAWN =
  '\u2694\uFE0F **Arena Grand Master** chest has spawned! Grab it fast \u2014 you have 5 minutes!';
const DMF_OPEN =
  '\uD83C\uDFAA **Darkmoon Faire** is now open! Head to Elwynn Forest (Alliance) or Mulgore (Horde).';
const STV_WARNING =
  '\uD83C\uDFA3 **STV Fishing Extravaganza** starts in 30 minutes! Bring your rods to Stranglethorn Vale!';
const STV_START =
  '\uD83C\uDFA3 **STV Fishing Extravaganza** has started! Head to Stranglethorn Vale \u2014 you have 2 hours!';

/**
 * Build the alert body for an event + trigger kind from its computed state.
 * Only BG's message is dynamic (current rotation short-name + active countdown);
 * the rest are fixed strings. Returns `null` for combinations that have no
 * message (e.g. an occurrence-only event's 'warning'), which callers skip.
 *
 * @param {string} event  - 'bg' | 'agm' | 'dmf' | 'stv'
 * @param {'occurrence'|'warning'} kind
 * @param {{ endsInMs?: number, label?: string, meta?: object }} [state]
 * @returns {string|null}
 */
export function renderMessage(event, kind, state = {}) {
  switch (event) {
    case 'bg':
      if (kind === 'occurrence') {
        const short = state.meta?.currentBG?.shortName ?? state.label ?? 'BG';
        return `\uD83C\uDFDF\uFE0F **${short} Weekend** is now live! Active for ${formatCountdown(
          state.endsInMs ?? 0
        )}.`;
      }
      return null;
    case 'agm':
      if (kind === 'warning') return AGM_WARNING;
      if (kind === 'occurrence') return AGM_SPAWN;
      return null;
    case 'dmf':
      if (kind === 'occurrence') return DMF_OPEN;
      return null;
    case 'stv':
      if (kind === 'warning') return STV_WARNING;
      if (kind === 'occurrence') return STV_START;
      return null;
    default:
      return null;
  }
}
