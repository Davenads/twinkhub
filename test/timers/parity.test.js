import test from 'node:test';
import assert from 'node:assert/strict';
import { DateTime } from 'luxon';
import { EVENTS } from '../../src/timers/events/index.js';

/**
 * Golden values frozen from the corrected Classic-Era schedule and cross-checked
 * by hand against known ground truth (the weekend of Aug 1–2 2026 was AB; the
 * Era Call-to-Arms cycle is AV→WSG→AB; the Gurubashi chest spawns at 01:00 MT;
 * the Darkmoon Faire opens the Sunday after the first Friday, per NWB
 * `Modules/DMF.lua`). If the schedule math ever drifts, these fail.
 *
 * Coverage: 3-BG rotation advance across four consecutive weeks (AB→AV→WSG→AB),
 * weekend open/close edges (Thu 2am / Tue 2am MT), AGM in-window / just-after /
 * boundary / 10-min-warning edge on the corrected 01:00 phase, DMF Sunday open +
 * mid-week + before + between-months, STV Sunday window mid/before, and a
 * DST-crossing instant (2026-11-15, after the Nov 1 fall-back).
 *
 * Per event, keys: active, startsInMs, endsInMs. Additionally bg carries
 * label + nextLabel; agm carries msUntilNext + msWindowLeft.
 */
const GOLDEN = {
  '2026-07-28T09:00:00Z': {
    bg: { active: false, startsInMs: 169200000, endsInMs: 601200000, label: 'AB', nextLabel: 'AV' },
    agm: { active: false, startsInMs: 3600000, endsInMs: 0, msUntilNext: 3600000, msWindowLeft: 0 },
    dmf: { active: false, startsInMs: 1033200000, endsInMs: 0 },
    stv: { active: false, startsInMs: 471600000, endsInMs: 0 }
  },
  '2026-08-01T12:00:00Z': {
    bg: { active: true, startsInMs: 0, endsInMs: 244800000, label: 'AB', nextLabel: 'AV' },
    agm: { active: false, startsInMs: 3600000, endsInMs: 0, msUntilNext: 3600000, msWindowLeft: 0 },
    dmf: { active: false, startsInMs: 676800000, endsInMs: 0 },
    stv: { active: false, startsInMs: 115200000, endsInMs: 0 }
  },
  '2026-08-04T09:00:00Z': {
    bg: {
      active: false,
      startsInMs: 169200000,
      endsInMs: 601200000,
      label: 'AV',
      nextLabel: 'WSG'
    },
    agm: { active: false, startsInMs: 3600000, endsInMs: 0, msUntilNext: 3600000, msWindowLeft: 0 },
    dmf: { active: false, startsInMs: 428400000, endsInMs: 0 },
    stv: { active: false, startsInMs: 471600000, endsInMs: 0 }
  },
  '2026-08-08T12:00:00Z': {
    bg: { active: true, startsInMs: 0, endsInMs: 244800000, label: 'AV', nextLabel: 'WSG' },
    agm: { active: false, startsInMs: 3600000, endsInMs: 0, msUntilNext: 3600000, msWindowLeft: 0 },
    dmf: { active: false, startsInMs: 72000000, endsInMs: 0 },
    stv: { active: false, startsInMs: 115200000, endsInMs: 0 }
  },
  '2026-08-11T09:00:00Z': {
    bg: {
      active: false,
      startsInMs: 169200000,
      endsInMs: 601200000,
      label: 'WSG',
      nextLabel: 'AB'
    },
    agm: { active: false, startsInMs: 3600000, endsInMs: 0, msUntilNext: 3600000, msWindowLeft: 0 },
    dmf: { active: true, startsInMs: 0, endsInMs: 428400000 },
    stv: { active: false, startsInMs: 471600000, endsInMs: 0 }
  },
  '2026-08-15T12:00:00Z': {
    bg: { active: true, startsInMs: 0, endsInMs: 244800000, label: 'WSG', nextLabel: 'AB' },
    agm: { active: false, startsInMs: 3600000, endsInMs: 0, msUntilNext: 3600000, msWindowLeft: 0 },
    dmf: { active: true, startsInMs: 0, endsInMs: 72000000 },
    stv: { active: false, startsInMs: 115200000, endsInMs: 0 }
  },
  '2026-08-18T09:00:00Z': {
    bg: { active: false, startsInMs: 169200000, endsInMs: 601200000, label: 'AB', nextLabel: 'AV' },
    agm: { active: false, startsInMs: 3600000, endsInMs: 0, msUntilNext: 3600000, msWindowLeft: 0 },
    dmf: { active: false, startsInMs: 1638000000, endsInMs: 0 },
    stv: { active: false, startsInMs: 471600000, endsInMs: 0 }
  },
  '2026-07-30T07:59:00Z': {
    bg: { active: false, startsInMs: 60000, endsInMs: 432060000, label: 'AB', nextLabel: 'AV' },
    agm: { active: false, startsInMs: 7260000, endsInMs: 0, msUntilNext: 7260000, msWindowLeft: 0 },
    dmf: { active: false, startsInMs: 864060000, endsInMs: 0 },
    stv: { active: false, startsInMs: 302460000, endsInMs: 0 }
  },
  '2026-07-30T08:00:00Z': {
    bg: { active: true, startsInMs: 0, endsInMs: 432000000, label: 'AB', nextLabel: 'AV' },
    agm: { active: false, startsInMs: 7200000, endsInMs: 0, msUntilNext: 7200000, msWindowLeft: 0 },
    dmf: { active: false, startsInMs: 864000000, endsInMs: 0 },
    stv: { active: false, startsInMs: 302400000, endsInMs: 0 }
  },
  '2026-08-04T07:59:00Z': {
    bg: { active: true, startsInMs: 0, endsInMs: 60000, label: 'AB', nextLabel: 'AV' },
    agm: { active: false, startsInMs: 7260000, endsInMs: 0, msUntilNext: 7260000, msWindowLeft: 0 },
    dmf: { active: false, startsInMs: 432060000, endsInMs: 0 },
    stv: { active: false, startsInMs: 475260000, endsInMs: 0 }
  },
  '2026-08-03T06:59:00Z': {
    bg: { active: true, startsInMs: 0, endsInMs: 90060000, label: 'AB', nextLabel: 'AV' },
    agm: { active: false, startsInMs: 60000, endsInMs: 0, msUntilNext: 60000, msWindowLeft: 0 },
    dmf: { active: false, startsInMs: 522060000, endsInMs: 0 },
    stv: { active: false, startsInMs: 565260000, endsInMs: 0 }
  },
  '2026-08-03T07:00:00Z': {
    bg: { active: true, startsInMs: 0, endsInMs: 90000000, label: 'AB', nextLabel: 'AV' },
    agm: {
      active: true,
      startsInMs: 0,
      endsInMs: 300000,
      msUntilNext: 10800000,
      msWindowLeft: 300000
    },
    dmf: { active: false, startsInMs: 522000000, endsInMs: 0 },
    stv: { active: false, startsInMs: 565200000, endsInMs: 0 }
  },
  '2026-08-03T07:04:00Z': {
    bg: { active: true, startsInMs: 0, endsInMs: 89760000, label: 'AB', nextLabel: 'AV' },
    agm: {
      active: true,
      startsInMs: 0,
      endsInMs: 60000,
      msUntilNext: 10560000,
      msWindowLeft: 60000
    },
    dmf: { active: false, startsInMs: 521760000, endsInMs: 0 },
    stv: { active: false, startsInMs: 564960000, endsInMs: 0 }
  },
  '2026-08-03T07:06:00Z': {
    bg: { active: true, startsInMs: 0, endsInMs: 89640000, label: 'AB', nextLabel: 'AV' },
    agm: {
      active: false,
      startsInMs: 10440000,
      endsInMs: 0,
      msUntilNext: 10440000,
      msWindowLeft: 0
    },
    dmf: { active: false, startsInMs: 521640000, endsInMs: 0 },
    stv: { active: false, startsInMs: 564840000, endsInMs: 0 }
  },
  '2026-08-03T06:50:00Z': {
    bg: { active: true, startsInMs: 0, endsInMs: 90600000, label: 'AB', nextLabel: 'AV' },
    agm: { active: false, startsInMs: 600000, endsInMs: 0, msUntilNext: 600000, msWindowLeft: 0 },
    dmf: { active: false, startsInMs: 522600000, endsInMs: 0 },
    stv: { active: false, startsInMs: 565800000, endsInMs: 0 }
  },
  '2026-08-03T12:00:00Z': {
    bg: { active: true, startsInMs: 0, endsInMs: 72000000, label: 'AB', nextLabel: 'AV' },
    agm: { active: false, startsInMs: 3600000, endsInMs: 0, msUntilNext: 3600000, msWindowLeft: 0 },
    dmf: { active: false, startsInMs: 504000000, endsInMs: 0 },
    stv: { active: false, startsInMs: 547200000, endsInMs: 0 }
  },
  '2026-08-09T09:00:00Z': {
    bg: { active: true, startsInMs: 0, endsInMs: 169200000, label: 'AV', nextLabel: 'WSG' },
    agm: { active: false, startsInMs: 3600000, endsInMs: 0, msUntilNext: 3600000, msWindowLeft: 0 },
    dmf: { active: true, startsInMs: 0, endsInMs: 601200000 },
    stv: { active: false, startsInMs: 39600000, endsInMs: 0 }
  },
  '2026-08-12T12:00:00Z': {
    bg: { active: false, startsInMs: 72000000, endsInMs: 504000000, label: 'WSG', nextLabel: 'AB' },
    agm: { active: false, startsInMs: 3600000, endsInMs: 0, msUntilNext: 3600000, msWindowLeft: 0 },
    dmf: { active: true, startsInMs: 0, endsInMs: 331200000 },
    stv: { active: false, startsInMs: 374400000, endsInMs: 0 }
  },
  '2026-08-20T12:00:00Z': {
    bg: { active: true, startsInMs: 0, endsInMs: 417600000, label: 'AB', nextLabel: 'AV' },
    agm: { active: false, startsInMs: 3600000, endsInMs: 0, msUntilNext: 3600000, msWindowLeft: 0 },
    dmf: { active: false, startsInMs: 1454400000, endsInMs: 0 },
    stv: { active: false, startsInMs: 288000000, endsInMs: 0 }
  },
  '2026-07-06T12:00:00Z': {
    bg: { active: true, startsInMs: 0, endsInMs: 72000000, label: 'WSG', nextLabel: 'AB' },
    agm: { active: false, startsInMs: 3600000, endsInMs: 0, msUntilNext: 3600000, msWindowLeft: 0 },
    dmf: { active: true, startsInMs: 0, endsInMs: 504000000 },
    stv: { active: false, startsInMs: 547200000, endsInMs: 0 }
  },
  '2026-08-02T20:30:00Z': {
    bg: { active: true, startsInMs: 0, endsInMs: 127800000, label: 'AB', nextLabel: 'AV' },
    agm: { active: false, startsInMs: 5400000, endsInMs: 0, msUntilNext: 5400000, msWindowLeft: 0 },
    dmf: { active: false, startsInMs: 559800000, endsInMs: 0 },
    stv: { active: true, startsInMs: 0, endsInMs: 5400000 }
  },
  '2026-08-02T18:00:00Z': {
    bg: { active: true, startsInMs: 0, endsInMs: 136800000, label: 'AB', nextLabel: 'AV' },
    agm: { active: false, startsInMs: 3600000, endsInMs: 0, msUntilNext: 3600000, msWindowLeft: 0 },
    dmf: { active: false, startsInMs: 568800000, endsInMs: 0 },
    stv: { active: false, startsInMs: 7200000, endsInMs: 0 }
  },
  '2026-11-15T12:00:00Z': {
    bg: { active: true, startsInMs: 0, endsInMs: 162000000, label: 'AB', nextLabel: 'AV' },
    agm: { active: false, startsInMs: 7200000, endsInMs: 0, msUntilNext: 7200000, msWindowLeft: 0 },
    dmf: { active: false, startsInMs: 1803600000, endsInMs: 0 },
    stv: { active: false, startsInMs: 32400000, endsInMs: 0 }
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
