import test from 'node:test';
import assert from 'node:assert/strict';
import os from 'node:os';
import path from 'node:path';
import { promises as fs } from 'node:fs';
import { DateTime } from 'luxon';
import { runTimerEngine } from '../../src/timers/engine.js';
import { loadLatches, saveLatches } from '../../src/timers/latchStore.js';

/** In-memory latch store for deterministic engine runs. */
function memStore(initial = {}) {
  let data = initial;
  return {
    load: async () => data,
    save: async (l) => {
      data = l;
    },
    get: () => data
  };
}

test('latchStore round-trips through a real file and seeds on missing', async () => {
  const file = path.join(os.tmpdir(), `twinkhub-latches-${process.pid}-${Date.now()}.json`);
  assert.deepEqual(await loadLatches(file), {}); // missing => empty seed
  await saveLatches({ agm: { wasActive: false, warnedStartMs: 123 } }, file);
  assert.deepEqual(await loadLatches(file), { agm: { wasActive: false, warnedStartMs: 123 } });
  await fs.rm(file, { force: true });
});

test('engine walks a real AGM window: exactly one warning + one occurrence', async () => {
  // 2026-07-28 (Tue, MDT = UTC-6). AGM spawns 01:00/04:00/…/13:00 MT; use the
  // 13:00 MT spawn = 19:00 UTC. Warning window 12:50-13:00 MT; occurrence window
  // 13:00-13:05 MT. Walk one tick/min from 18:45 UTC (12:45 MT) to 19:10 UTC.
  const store = memStore();
  const dispatched = [];
  const dispatch = async (fire) => {
    dispatched.push(fire);
  };

  const fired = [];
  for (let m = 45; m <= 70; m++) {
    const now = DateTime.utc(2026, 7, 28, 18, 0).plus({ minutes: m });
    const { fires } = await runTimerEngine({ now, dispatch, store });
    for (const f of fires) fired.push({ min: m, ...f });
  }

  // 12:50 MT (m=50) warning, 13:00 MT (m=60) occurrence — and nothing else.
  assert.deepEqual(fired, [
    { min: 50, event: 'agm', kind: 'warning' },
    { min: 60, event: 'agm', kind: 'occurrence' }
  ]);

  // dispatch received the policy + state snapshot for each fire.
  assert.equal(dispatched.length, 2);
  assert.deepEqual(dispatched[0].policy, { channel: 'ping', dm: true }); // warning
  assert.deepEqual(dispatched[1].policy, { channel: 'broadcast', dm: false }); // spawn
  assert.equal(dispatched[1].state.active, true);
});

test('engine cold-start mid-window seeds without firing (no retro-spam)', async () => {
  // Start fresh at 13:02 MT (19:02 UTC), already inside the AGM occurrence.
  const store = memStore();
  const seen = [];
  await runTimerEngine({
    now: DateTime.utc(2026, 7, 28, 19, 2),
    dispatch: async (f) => seen.push(f),
    store
  });
  assert.deepEqual(seen, []); // seeded active, no occurrence fired
  assert.equal(store.get().agm.wasActive, true);
});
