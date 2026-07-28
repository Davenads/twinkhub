import test from 'node:test';
import assert from 'node:assert/strict';
import { DateTime } from 'luxon';
import { EVENTS } from '../../src/timers/events/index.js';

/**
 * Golden values captured by running the wow-timers Python source of truth
 * (`python-bots/shared.py`: get_rotation_info / get_agm_state / get_dmf_state /
 * get_stv_state) over each timestamp and normalizing to TwinkHub's shape. If the
 * JS port ever drifts from the Python schedule math, these fail.
 *
 * Coverage: rotation index advance (AV→EOTS→WSG→AB), weekend active/idle edges,
 * AGM in-window / just-after / at-3h-boundary, DMF first-full-week start + before
 * + between-months, STV Sunday window start/mid/end→next/before/weekday, and a
 * DST-crossing instant (2026-11-15, after the Nov 1 fall-back).
 *
 * Per event, keys: active, startsInMs, endsInMs. Additionally bg carries
 * label + nextLabel; agm carries msUntilNext + msWindowLeft.
 */
const GOLDEN = {
  '2026-03-24T08:00:00Z': {
    bg: { active: false, startsInMs: 172800000, endsInMs: 604800000, label: 'AV', nextLabel: 'EOTS' },
    agm: { active: false, startsInMs: 3600000, endsInMs: 0, msUntilNext: 3600000, msWindowLeft: 0 },
    dmf: { active: false, startsInMs: 1116060000, endsInMs: 0 },
    stv: { active: false, startsInMs: 475200000, endsInMs: 0 }
  },
  '2026-03-27T00:00:00Z': {
    bg: { active: true, startsInMs: 0, endsInMs: 374400000, label: 'AV', nextLabel: 'EOTS' },
    agm: { active: true, startsInMs: 0, endsInMs: 300000, msUntilNext: 10800000, msWindowLeft: 300000 },
    dmf: { active: false, startsInMs: 885660000, endsInMs: 0 },
    stv: { active: false, startsInMs: 244800000, endsInMs: 0 }
  },
  '2026-03-31T08:00:00Z': {
    bg: { active: false, startsInMs: 172800000, endsInMs: 604800000, label: 'EOTS', nextLabel: 'WSG' },
    agm: { active: false, startsInMs: 3600000, endsInMs: 0, msUntilNext: 3600000, msWindowLeft: 0 },
    dmf: { active: false, startsInMs: 511260000, endsInMs: 0 },
    stv: { active: false, startsInMs: 475200000, endsInMs: 0 }
  },
  '2026-04-07T08:00:00Z': {
    bg: { active: false, startsInMs: 172800000, endsInMs: 604800000, label: 'WSG', nextLabel: 'AB' },
    agm: { active: false, startsInMs: 3600000, endsInMs: 0, msUntilNext: 3600000, msWindowLeft: 0 },
    dmf: { active: true, startsInMs: 0, endsInMs: 511260000 },
    stv: { active: false, startsInMs: 475200000, endsInMs: 0 }
  },
  '2026-11-15T12:00:00Z': {
    bg: { active: true, startsInMs: 0, endsInMs: 162000000, label: 'EOTS', nextLabel: 'WSG' },
    agm: { active: false, startsInMs: 3600000, endsInMs: 0, msUntilNext: 3600000, msWindowLeft: 0 },
    dmf: { active: false, startsInMs: 1882860000, endsInMs: 0 },
    stv: { active: false, startsInMs: 32400000, endsInMs: 0 }
  },
  '2026-04-01T06:00:00Z': {
    bg: { active: false, startsInMs: 93600000, endsInMs: 525600000, label: 'EOTS', nextLabel: 'WSG' },
    agm: { active: true, startsInMs: 0, endsInMs: 300000, msUntilNext: 10800000, msWindowLeft: 300000 },
    dmf: { active: false, startsInMs: 432060000, endsInMs: 0 },
    stv: { active: false, startsInMs: 396000000, endsInMs: 0 }
  },
  '2026-04-01T06:04:00Z': {
    bg: { active: false, startsInMs: 93360000, endsInMs: 525360000, label: 'EOTS', nextLabel: 'WSG' },
    agm: { active: true, startsInMs: 0, endsInMs: 60000, msUntilNext: 10560000, msWindowLeft: 60000 },
    dmf: { active: false, startsInMs: 431820000, endsInMs: 0 },
    stv: { active: false, startsInMs: 395760000, endsInMs: 0 }
  },
  '2026-04-01T06:06:00Z': {
    bg: { active: false, startsInMs: 93240000, endsInMs: 525240000, label: 'EOTS', nextLabel: 'WSG' },
    agm: { active: false, startsInMs: 10440000, endsInMs: 0, msUntilNext: 10440000, msWindowLeft: 0 },
    dmf: { active: false, startsInMs: 431700000, endsInMs: 0 },
    stv: { active: false, startsInMs: 395640000, endsInMs: 0 }
  },
  '2026-04-01T08:00:00Z': {
    bg: { active: false, startsInMs: 86400000, endsInMs: 518400000, label: 'EOTS', nextLabel: 'WSG' },
    agm: { active: false, startsInMs: 3600000, endsInMs: 0, msUntilNext: 3600000, msWindowLeft: 0 },
    dmf: { active: false, startsInMs: 424860000, endsInMs: 0 },
    stv: { active: false, startsInMs: 388800000, endsInMs: 0 }
  },
  '2026-04-06T06:01:00Z': {
    bg: { active: true, startsInMs: 0, endsInMs: 93540000, label: 'EOTS', nextLabel: 'WSG' },
    agm: { active: true, startsInMs: 0, endsInMs: 240000, msUntilNext: 10740000, msWindowLeft: 240000 },
    dmf: { active: true, startsInMs: 0, endsInMs: 604800000 },
    stv: { active: false, startsInMs: 568740000, endsInMs: 0 }
  },
  '2026-04-01T12:00:00Z': {
    bg: { active: false, startsInMs: 72000000, endsInMs: 504000000, label: 'EOTS', nextLabel: 'WSG' },
    agm: { active: true, startsInMs: 0, endsInMs: 300000, msUntilNext: 10800000, msWindowLeft: 300000 },
    dmf: { active: false, startsInMs: 410460000, endsInMs: 0 },
    stv: { active: false, startsInMs: 374400000, endsInMs: 0 }
  },
  '2026-04-20T12:00:00Z': {
    bg: { active: true, startsInMs: 0, endsInMs: 72000000, label: 'AB', nextLabel: 'AV' },
    agm: { active: true, startsInMs: 0, endsInMs: 300000, msUntilNext: 10800000, msWindowLeft: 300000 },
    dmf: { active: false, startsInMs: 1188060000, endsInMs: 0 },
    stv: { active: false, startsInMs: 547200000, endsInMs: 0 }
  },
  '2026-04-05T20:00:00Z': {
    bg: { active: true, startsInMs: 0, endsInMs: 129600000, label: 'EOTS', nextLabel: 'WSG' },
    agm: { active: false, startsInMs: 3600000, endsInMs: 0, msUntilNext: 3600000, msWindowLeft: 0 },
    dmf: { active: false, startsInMs: 36060000, endsInMs: 0 },
    stv: { active: true, startsInMs: 0, endsInMs: 7200000 }
  },
  '2026-04-05T21:00:00Z': {
    bg: { active: true, startsInMs: 0, endsInMs: 126000000, label: 'EOTS', nextLabel: 'WSG' },
    agm: { active: true, startsInMs: 0, endsInMs: 300000, msUntilNext: 10800000, msWindowLeft: 300000 },
    dmf: { active: false, startsInMs: 32460000, endsInMs: 0 },
    stv: { active: true, startsInMs: 0, endsInMs: 3600000 }
  },
  '2026-04-05T22:00:00Z': {
    bg: { active: true, startsInMs: 0, endsInMs: 122400000, label: 'EOTS', nextLabel: 'WSG' },
    agm: { active: false, startsInMs: 7200000, endsInMs: 0, msUntilNext: 7200000, msWindowLeft: 0 },
    dmf: { active: false, startsInMs: 28860000, endsInMs: 0 },
    stv: { active: false, startsInMs: 597600000, endsInMs: 0 }
  },
  '2026-04-05T12:00:00Z': {
    bg: { active: true, startsInMs: 0, endsInMs: 158400000, label: 'EOTS', nextLabel: 'WSG' },
    agm: { active: true, startsInMs: 0, endsInMs: 300000, msUntilNext: 10800000, msWindowLeft: 300000 },
    dmf: { active: false, startsInMs: 64860000, endsInMs: 0 },
    stv: { active: false, startsInMs: 28800000, endsInMs: 0 }
  },
  '2026-04-08T12:00:00Z': {
    bg: { active: false, startsInMs: 72000000, endsInMs: 504000000, label: 'WSG', nextLabel: 'AB' },
    agm: { active: true, startsInMs: 0, endsInMs: 300000, msUntilNext: 10800000, msWindowLeft: 300000 },
    dmf: { active: true, startsInMs: 0, endsInMs: 410460000 },
    stv: { active: false, startsInMs: 374400000, endsInMs: 0 }
  }
};

for (const [ts, events] of Object.entries(GOLDEN)) {
  test(`schedule parity @ ${ts}`, () => {
    const now = DateTime.fromISO(ts, { zone: 'utc' });
    for (const [key, exp] of Object.entries(events)) {
      const got = EVENTS[key].getState(now);
      const at = `${key} @ ${ts}`;
      assert.equal(got.active, exp.active, `${at} active`);
      assert.equal(got.startsInMs, exp.startsInMs, `${at} startsInMs`);
      assert.equal(got.endsInMs, exp.endsInMs, `${at} endsInMs`);
      if (exp.label !== undefined) assert.equal(got.label, exp.label, `${at} label`);
      if (exp.nextLabel !== undefined) {
        assert.equal(got.meta.nextBG.shortName, exp.nextLabel, `${at} nextBG`);
      }
      if (exp.msUntilNext !== undefined) {
        assert.equal(got.meta.msUntilNext, exp.msUntilNext, `${at} meta.msUntilNext`);
      }
      if (exp.msWindowLeft !== undefined) {
        assert.equal(got.meta.msWindowLeft, exp.msWindowLeft, `${at} meta.msWindowLeft`);
      }
    }
  });
}
