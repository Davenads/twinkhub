import test from 'node:test';
import assert from 'node:assert/strict';
import {
  urgencyScore,
  rankedEvents,
  renderEventLine,
  eventTitle,
  renderEventsSummary
} from '../../src/timers/summary.js';

const MIN = 60 * 1000;
const HOUR = 60 * MIN;
const DAY = 24 * HOUR;
const BIG = 100 * DAY;

/** Build a normalized state: active(ms=endsIn) or idle(ms=startsIn). */
function st(active, ms, extra = {}) {
  return active
    ? { active: true, startsInMs: 0, endsInMs: ms, label: extra.label ?? '', meta: extra.meta ?? {} }
    : { active: false, startsInMs: ms, endsInMs: 0, label: extra.label ?? '', meta: extra.meta ?? {} };
}

test('urgencyScore ranks active (by end) ahead of idle (by start)', () => {
  assert.equal(urgencyScore(st(true, 3 * MIN)), 3 * MIN);
  assert.equal(urgencyScore(st(false, 2 * HOUR)), BIG + 2 * HOUR);
  // any active event outscores any idle one
  assert.ok(urgencyScore(st(true, 30 * DAY)) < urgencyScore(st(false, 0)));
});

test('rankedEvents orders active-soonest then idle-soonest', () => {
  const states = {
    bg: st(false, 2 * HOUR),
    agm: st(true, 3 * MIN),
    dmf: st(false, 10 * DAY),
    stv: st(true, 1 * HOUR)
  };
  assert.deepEqual(rankedEvents(states), ['agm', 'stv', 'bg', 'dmf']);
});

test('renderEventLine — BG shows current + next, active vs idle', () => {
  const meta = { currentBG: { shortName: 'AV' }, nextBG: { shortName: 'WSG' } };
  assert.equal(
    renderEventLine('bg', st(true, 2 * DAY + 3 * HOUR, { meta })),
    '**AV** live \u00b7 ends in 2d 3h 0m\nNext: WSG'
  );
  assert.equal(
    renderEventLine('bg', st(false, 2 * HOUR, { meta })),
    'Next: **AV** in 2h 0m\nThen: WSG'
  );
});

test('renderEventLine — AGM / DMF / STV active vs idle', () => {
  assert.equal(renderEventLine('agm', st(true, 3 * MIN)), 'Chest up! \u00b7 closes in 3m');
  assert.equal(renderEventLine('agm', st(false, 2 * HOUR + 34 * MIN)), 'Next chest in 2h 34m');
  assert.equal(renderEventLine('dmf', st(true, 3 * DAY)), 'Open \u00b7 ends in 3d 0m');
  assert.equal(renderEventLine('dmf', st(false, 10 * DAY)), 'Opens in 10d 0m');
  assert.equal(renderEventLine('stv', st(true, 1 * HOUR + 20 * MIN)), 'Active \u00b7 ends in 1h 20m');
  assert.equal(renderEventLine('stv', st(false, 4 * DAY + 2 * HOUR)), 'Starts in 4d 2h 0m');
});

test('eventTitle returns the display name', () => {
  assert.equal(eventTitle('bg'), 'BG Weekend');
  assert.equal(eventTitle('stv'), 'STV Fishing');
});

test('renderEventsSummary builds a ranked embed with a live updated cue', () => {
  const states = {
    bg: st(false, 2 * HOUR, { meta: { currentBG: { shortName: 'AV' }, nextBG: { shortName: 'WSG' } } }),
    agm: st(true, 3 * MIN),
    dmf: st(false, 10 * DAY),
    stv: st(true, 1 * HOUR)
  };
  const { embeds } = renderEventsSummary(states, { now: 1_700_000_000_000 });
  const json = embeds[0].toJSON();

  assert.equal(json.description, 'Updated <t:1700000000:R>');
  assert.deepEqual(
    json.fields.map((f) => f.name),
    ['Arena Grand Master', 'STV Fishing', 'BG Weekend', 'Darkmoon Faire']
  );
  assert.equal(json.fields[0].value, 'Chest up! \u00b7 closes in 3m');
  assert.equal(json.fields[1].value, 'Active \u00b7 ends in 1h 0m');
});

test('renderEventsSummary leads each field value with its event icon when a store is passed', () => {
  const store = {
    emoji: {
      events: {
        wsg: { name: 'wsg', id: '1' },
        arena: { name: 'arena', id: '2' },
        fishing: { name: 'fishing', id: '3' }
        // dmftf intentionally omitted -> that row degrades to text-only
      }
    }
  };
  const states = {
    bg: st(true, 2 * DAY, { meta: { currentBG: { shortName: 'WSG' }, nextBG: { shortName: 'AB' } } }),
    agm: st(true, 3 * MIN),
    dmf: st(false, 10 * DAY),
    stv: st(true, 1 * HOUR)
  };
  const byName = {};
  for (const f of renderEventsSummary(states, { store }).embeds[0].toJSON().fields) byName[f.name] = f.value;

  assert.ok(byName['BG Weekend'].startsWith('<:wsg:1> '), 'BG icon tracks the current battleground');
  assert.ok(byName['Arena Grand Master'].startsWith('<:arena:2> '), 'AGM leads with the arena icon');
  assert.ok(byName['STV Fishing'].startsWith('<:fishing:3> '), 'STV leads with the fishing icon');
  assert.ok(!byName['Darkmoon Faire'].includes('<:'), 'an unregistered event icon degrades to text-only');
});
