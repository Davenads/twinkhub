import { EmbedBuilder } from 'discord.js';
import { formatCountdown } from '../lib/time.js';
import { eventIcon } from '../content/store.js';
import { EVENT_KEYS } from './events/index.js';

// 100 days — pushes idle events after active ones in the urgency sort. Ported
// from shared.py `_BIG` so /events and /nextevent order events exactly like the
// four bots' `compute_rank` did (active, soonest-to-end first; then idle,
// soonest-to-start).
const BIG = 100 * 24 * 60 * 60 * 1000;

const EMBED_COLOR = 0xc8aa6e; // muted gold

/** Display metadata per event. */
export const DISPLAY = {
  bg: { name: 'BG Weekend' },
  agm: { name: 'Arena Grand Master' },
  dmf: { name: 'Darkmoon Faire' },
  stv: { name: 'STV Fishing' }
};

// Event -> application-emoji registry key (in emoji.json `events`). BG and DMF
// are dynamic: BG's icon tracks the current battleground (av/wsg/ab) and DMF's
// tracks the faire's Era zone (Elwynn/Mulgore). The rest are static. Custom
// emoji don't render in embed field NAMES, so these lead the field VALUE instead.
const EVENT_EMOJI = { agm: 'arena', stv: 'fishing' };

// Classic Era DMF zone (state.meta.location.short) -> emoji registry key.
const DMF_ZONE_EMOJI = { Elwynn: 'dmfef', Mulgore: 'dmftb' };

/** Registry key for an event's icon, or null when there's no sensible glyph. */
function eventEmojiKey(key, state) {
  if (key === 'bg') return state?.meta?.currentBG?.shortName?.toLowerCase() ?? null;
  if (key === 'dmf') return DMF_ZONE_EMOJI[state?.meta?.location?.short] ?? null;
  return EVENT_EMOJI[key] ?? null;
}

/** Slash-command choices ({ name, value }) for event-selection options. */
export const EVENT_CHOICES = EVENT_KEYS.map((k) => ({ name: DISPLAY[k].name, value: k }));

/** Urgency score: active events (by soonest to end) rank before idle ones (by soonest to start). */
export function urgencyScore(state) {
  return state.active ? state.endsInMs : BIG + state.startsInMs;
}

/** Event keys sorted most-urgent first; ties fall back to canonical EVENT_KEYS order. */
export function rankedEvents(states) {
  return [...EVENT_KEYS].sort((a, b) => {
    const d = urgencyScore(states[a]) - urgencyScore(states[b]);
    return d !== 0 ? d : EVENT_KEYS.indexOf(a) - EVENT_KEYS.indexOf(b);
  });
}

/** One-line (BG: two-line) status string for an event's current state. */
export function renderEventLine(key, state) {
  switch (key) {
    case 'bg': {
      const cur = state.meta?.currentBG?.shortName ?? state.label ?? 'BG';
      const next = state.meta?.nextBG?.shortName;
      if (state.active) {
        return (
          `**${cur}** live \u00b7 ends in ${formatCountdown(state.endsInMs)}` +
          (next ? `\nNext: ${next}` : '')
        );
      }
      return (
        `Next: **${cur}** in ${formatCountdown(state.startsInMs)}` +
        (next ? `\nThen: ${next}` : '')
      );
    }
    case 'agm':
      return state.active
        ? `Chest up! \u00b7 closes in ${formatCountdown(state.endsInMs)}`
        : `Next chest in ${formatCountdown(state.startsInMs)}`;
    case 'dmf': {
      // Name the Era zone (Elwynn/Mulgore) when known; degrade to zoneless text.
      const zone = state.meta?.location?.name;
      if (state.active) {
        return zone
          ? `**${zone}** \u00b7 open, ends in ${formatCountdown(state.endsInMs)}`
          : `Open \u00b7 ends in ${formatCountdown(state.endsInMs)}`;
      }
      return zone
        ? `**${zone}** \u00b7 opens in ${formatCountdown(state.startsInMs)}`
        : `Opens in ${formatCountdown(state.startsInMs)}`;
    }
    case 'stv':
      return state.active
        ? `Active \u00b7 ends in ${formatCountdown(state.endsInMs)}`
        : `Starts in ${formatCountdown(state.startsInMs)}`;
    default:
      return state.active
        ? `Active \u00b7 ends in ${formatCountdown(state.endsInMs)}`
        : `Starts in ${formatCountdown(state.startsInMs)}`;
  }
}

/** `${name}` header for an event's dashboard field / single-event reply. */
export function eventTitle(key) {
  return DISPLAY[key]?.name ?? key.toUpperCase();
}

/**
 * Build the shared events dashboard payload (`{ embeds: [EmbedBuilder] }`).
 * Fields are urgency-sorted; the description carries a live "Updated <t:…:R>"
 * cue (Discord renders timestamp markdown in embed descriptions/field values).
 *
 * This is the single rendering used by BOTH the on-demand `/events` command and
 * the persistent timer board, so the two can never drift.
 *
 * @param {Record<string, object>} states  - from getAllStates(now)
 * @param {{ now?: number }} [opts]
 */
export function renderEventsSummary(states, { now = Date.now(), store = null } = {}) {
  const embed = new EmbedBuilder()
    .setTitle('WoW Classic \u2014 Event Timers')
    .setColor(EMBED_COLOR)
    .setDescription(`Updated <t:${Math.floor(now / 1000)}:R>`);

  for (const key of rankedEvents(states)) {
    const line = renderEventLine(key, states[key]);
    const icon = eventIcon(store, eventEmojiKey(key, states[key]));
    embed.addFields({ name: eventTitle(key), value: icon ? `${icon} ${line}` : line });
  }

  return { embeds: [embed] };
}
