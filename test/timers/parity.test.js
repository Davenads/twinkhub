import test from 'node:test';
import assert from 'node:assert/strict';
import { DateTime } from 'luxon';
import { EVENTS } from '../../src/timers/events/index.js';

/**
 * Golden values frozen from the corrected Classic-Era schedule and cross-checked
 * by hand against known ground truth (the weekend of Aug 1–2 2026 was AB; the
 * Era Call-to-Arms cycle is AV→WSG→AB; the Gurubashi chest spawns at 01:00 PT;
 * the Darkmoon Faire opens the Sunday after the first Friday, per NWB
 * `Modules/DMF.lua`). Schedules run on Whitemane realm time (US Pacific). If the
 * schedule math ever drifts, these fail.
 *
 * Coverage: 3-BG rotation advance across four consecutive weeks (AB→AV→WSG→AB),
 * weekend open/close edges (Thu 2am / Tue 2am PT), AGM in-window / just-after /
 * boundary / 10-min-warning edge on the corrected 01:00 phase, DMF Sunday open +
 * mid-week + before + between-months, STV Sunday window mid/before, and a
 * DST-crossing instant (2026-11-15, after the Nov 1 fall-back).
 *
 * Per event, keys: active, startsInMs, endsInMs. Additionally bg carries
 * label + nextLabel; agm carries msUntilNext + msWindowLeft.
 */
const GOLDEN = {
  '2026-07-28T09:00:00Z': {
    bg: { active: false, startsInMs: 172800000, endsInMs: 604800000, label: 'AB', nextLabel: 'AV' },
    agm: { active: false, startsInMs: 7200000, endsInMs: 0, msUntilNext: 7200000, msWindowLeft: 0 },
    dmf: { active: false, startsInMs: 1036800000, endsInMs: 0 },
    stv: { active: false, startsInMs: 475200000, endsInMs: 0 }
  },
  '2026-08-01T12:00:00Z': {
    bg: { active: true, startsInMs: 0, endsInMs: 248400000, label: 'AB', nextLabel: 'AV' },
    agm: { active: false, startsInMs: 7200000, endsInMs: 0, msUntilNext: 7200000, msWindowLeft: 0 },
    dmf: { active: false, startsInMs: 680400000, endsInMs: 0 },
    stv: { active: false, startsInMs: 118800000, endsInMs: 0 }
  },
  '2026-08-04T09:00:00Z': {
    bg: {
      active: false,
      startsInMs: 172800000,
      endsInMs: 604800000,
      label: 'AV',
      nextLabel: 'WSG'
    },
    agm: { active: false, startsInMs: 7200000, endsInMs: 0, msUntilNext: 7200000, msWindowLeft: 0 },
    dmf: { active: false, startsInMs: 432000000, endsInMs: 0 },
    stv: { active: false, startsInMs: 475200000, endsInMs: 0 }
  },
  '2026-08-08T12:00:00Z': {
    bg: { active: true, startsInMs: 0, endsInMs: 248400000, label: 'AV', nextLabel: 'WSG' },
    agm: { active: false, startsInMs: 7200000, endsInMs: 0, msUntilNext: 7200000, msWindowLeft: 0 },
    dmf: { active: false, startsInMs: 75600000, endsInMs: 0 },
    stv: { active: false, startsInMs: 118800000, endsInMs: 0 }
  },
  '2026-08-11T09:00:00Z': {
    bg: {
      active: false,
      startsInMs: 172800000,
      endsInMs: 604800000,
      label: 'WSG',
      nextLabel: 'AB'
    },
    agm: { active: false, startsInMs: 7200000, endsInMs: 0, msUntilNext: 7200000, msWindowLeft: 0 },
    dmf: { active: true, startsInMs: 0, endsInMs: 432000000 },
    stv: { active: false, startsInMs: 475200000, endsInMs: 0 }
  },
  '2026-08-15T12:00:00Z': {
    bg: { active: true, startsInMs: 0, endsInMs: 248400000, label: 'WSG', nextLabel: 'AB' },
    agm: { active: false, startsInMs: 7200000, endsInMs: 0, msUntilNext: 7200000, msWindowLeft: 0 },
    dmf: { active: true, startsInMs: 0, endsInMs: 75600000 },
    stv: { active: false, startsInMs: 118800000, endsInMs: 0 }
  },
  '2026-08-18T09:00:00Z': {
    bg: { active: false, startsInMs: 172800000, endsInMs: 604800000, label: 'AB', nextLabel: 'AV' },
    agm: { active: false, startsInMs: 7200000, endsInMs: 0, msUntilNext: 7200000, msWindowLeft: 0 },
    dmf: { active: false, startsInMs: 1641600000, endsInMs: 0 },
    stv: { active: false, startsInMs: 475200000, endsInMs: 0 }
  },
  '2026-07-30T07:59:00Z': {
    bg: { active: false, startsInMs: 3660000, endsInMs: 435660000, label: 'AB', nextLabel: 'AV' },
    agm: { active: false, startsInMs: 60000, endsInMs: 0, msUntilNext: 60000, msWindowLeft: 0 },
    dmf: { active: false, startsInMs: 867660000, endsInMs: 0 },
    stv: { active: false, startsInMs: 306060000, endsInMs: 0 }
  },
  '2026-07-30T08:00:00Z': {
    bg: { active: false, startsInMs: 3600000, endsInMs: 435600000, label: 'AB', nextLabel: 'AV' },
    agm: {
      active: true,
      startsInMs: 0,
      endsInMs: 300000,
      msUntilNext: 10800000,
      msWindowLeft: 300000
    },
    dmf: { active: false, startsInMs: 867600000, endsInMs: 0 },
    stv: { active: false, startsInMs: 306000000, endsInMs: 0 }
  },
  '2026-08-04T07:59:00Z': {
    bg: { active: true, startsInMs: 0, endsInMs: 3660000, label: 'AB', nextLabel: 'AV' },
    agm: { active: false, startsInMs: 60000, endsInMs: 0, msUntilNext: 60000, msWindowLeft: 0 },
    dmf: { active: false, startsInMs: 435660000, endsInMs: 0 },
    stv: { active: false, startsInMs: 478860000, endsInMs: 0 }
  },
  '2026-08-03T06:59:00Z': {
    bg: { active: true, startsInMs: 0, endsInMs: 93660000, label: 'AB', nextLabel: 'AV' },
    agm: { active: false, startsInMs: 3660000, endsInMs: 0, msUntilNext: 3660000, msWindowLeft: 0 },
    dmf: { active: false, startsInMs: 525660000, endsInMs: 0 },
    stv: { active: false, startsInMs: 568860000, endsInMs: 0 }
  },
  '2026-08-03T07:00:00Z': {
    bg: { active: true, startsInMs: 0, endsInMs: 93600000, label: 'AB', nextLabel: 'AV' },
    agm: { active: false, startsInMs: 3600000, endsInMs: 0, msUntilNext: 3600000, msWindowLeft: 0 },
    dmf: { active: false, startsInMs: 525600000, endsInMs: 0 },
    stv: { active: false, startsInMs: 568800000, endsInMs: 0 }
  },
  '2026-08-03T07:04:00Z': {
    bg: { active: true, startsInMs: 0, endsInMs: 93360000, label: 'AB', nextLabel: 'AV' },
    agm: { active: false, startsInMs: 3360000, endsInMs: 0, msUntilNext: 3360000, msWindowLeft: 0 },
    dmf: { active: false, startsInMs: 525360000, endsInMs: 0 },
    stv: { active: false, startsInMs: 568560000, endsInMs: 0 }
  },
  '2026-08-03T07:06:00Z': {
    bg: { active: true, startsInMs: 0, endsInMs: 93240000, label: 'AB', nextLabel: 'AV' },
    agm: { active: false, startsInMs: 3240000, endsInMs: 0, msUntilNext: 3240000, msWindowLeft: 0 },
    dmf: { active: false, startsInMs: 525240000, endsInMs: 0 },
    stv: { active: false, startsInMs: 568440000, endsInMs: 0 }
  },
  '2026-08-03T06:50:00Z': {
    bg: { active: true, startsInMs: 0, endsInMs: 94200000, label: 'AB', nextLabel: 'AV' },
    agm: { active: false, startsInMs: 4200000, endsInMs: 0, msUntilNext: 4200000, msWindowLeft: 0 },
    dmf: { active: false, startsInMs: 526200000, endsInMs: 0 },
    stv: { active: false, startsInMs: 569400000, endsInMs: 0 }
  },
  '2026-08-03T12:00:00Z': {
    bg: { active: true, startsInMs: 0, endsInMs: 75600000, label: 'AB', nextLabel: 'AV' },
    agm: { active: false, startsInMs: 7200000, endsInMs: 0, msUntilNext: 7200000, msWindowLeft: 0 },
    dmf: { active: false, startsInMs: 507600000, endsInMs: 0 },
    stv: { active: false, startsInMs: 550800000, endsInMs: 0 }
  },
  '2026-08-09T09:00:00Z': {
    bg: { active: true, startsInMs: 0, endsInMs: 172800000, label: 'AV', nextLabel: 'WSG' },
    agm: { active: false, startsInMs: 7200000, endsInMs: 0, msUntilNext: 7200000, msWindowLeft: 0 },
    dmf: { active: true, startsInMs: 0, endsInMs: 604800000 },
    stv: { active: false, startsInMs: 43200000, endsInMs: 0 }
  },
  '2026-08-12T12:00:00Z': {
    bg: { active: false, startsInMs: 75600000, endsInMs: 507600000, label: 'WSG', nextLabel: 'AB' },
    agm: { active: false, startsInMs: 7200000, endsInMs: 0, msUntilNext: 7200000, msWindowLeft: 0 },
    dmf: { active: true, startsInMs: 0, endsInMs: 334800000 },
    stv: { active: false, startsInMs: 378000000, endsInMs: 0 }
  },
  '2026-08-20T12:00:00Z': {
    bg: { active: true, startsInMs: 0, endsInMs: 421200000, label: 'AB', nextLabel: 'AV' },
    agm: { active: false, startsInMs: 7200000, endsInMs: 0, msUntilNext: 7200000, msWindowLeft: 0 },
    dmf: { active: false, startsInMs: 1458000000, endsInMs: 0 },
    stv: { active: false, startsInMs: 291600000, endsInMs: 0 }
  },
  '2026-07-06T12:00:00Z': {
    bg: { active: true, startsInMs: 0, endsInMs: 75600000, label: 'WSG', nextLabel: 'AB' },
    agm: { active: false, startsInMs: 7200000, endsInMs: 0, msUntilNext: 7200000, msWindowLeft: 0 },
    dmf: { active: true, startsInMs: 0, endsInMs: 507600000 },
    stv: { active: false, startsInMs: 550800000, endsInMs: 0 }
  },
  '2026-08-02T20:30:00Z': {
    bg: { active: true, startsInMs: 0, endsInMs: 131400000, label: 'AB', nextLabel: 'AV' },
    agm: { active: false, startsInMs: 9000000, endsInMs: 0, msUntilNext: 9000000, msWindowLeft: 0 },
    dmf: { active: false, startsInMs: 563400000, endsInMs: 0 },
    stv: { active: false, startsInMs: 1800000, endsInMs: 0 }
  },
  '2026-08-02T18:00:00Z': {
    bg: { active: true, startsInMs: 0, endsInMs: 140400000, label: 'AB', nextLabel: 'AV' },
    agm: { active: false, startsInMs: 7200000, endsInMs: 0, msUntilNext: 7200000, msWindowLeft: 0 },
    dmf: { active: false, startsInMs: 572400000, endsInMs: 0 },
    stv: { active: false, startsInMs: 10800000, endsInMs: 0 }
  },
  '2026-11-15T12:00:00Z': {
    bg: { active: true, startsInMs: 0, endsInMs: 165600000, label: 'AB', nextLabel: 'AV' },
    agm: {
      active: true,
      startsInMs: 0,
      endsInMs: 300000,
      msUntilNext: 10800000,
      msWindowLeft: 300000
    },
    dmf: { active: false, startsInMs: 1807200000, endsInMs: 0 },
    stv: { active: false, startsInMs: 36000000, endsInMs: 0 }
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
