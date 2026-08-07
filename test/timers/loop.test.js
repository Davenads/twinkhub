import test from 'node:test';
import assert from 'node:assert/strict';
import { createTickLoop } from '../../src/timers/loop.js';

/** A promise you can resolve from the outside — lets a test hold a tick open. */
function deferred() {
  let resolve;
  const promise = new Promise((r) => {
    resolve = r;
  });
  return { promise, resolve };
}

test('an overlapping tick is dropped while the previous one is still running', async () => {
  const gate = deferred();
  let active = 0;
  let maxActive = 0;
  const runTick = async () => {
    active += 1;
    maxActive = Math.max(maxActive, active);
    await gate.promise;
    active -= 1;
  };

  const skips = [];
  const loop = createTickLoop({
    runTick,
    intervalMs: 1000,
    logger: { warn: (m) => skips.push(m) }
  });

  const first = loop.tick(); // enters runTick, parks on the gate
  const second = await loop.tick(); // arrives mid-flight → skipped

  assert.equal(second, false, 'the overlapping tick returns false');
  assert.equal(loop.isRunning(), true, 'the first tick is still in flight');
  assert.equal(skips.length, 1, 'the skip is logged once');

  gate.resolve();
  assert.equal(await first, true, 'the first tick completes normally');
  assert.equal(maxActive, 1, 'runTick never ran concurrently');
});

test('a fresh tick runs again after the previous one settles', async () => {
  let runs = 0;
  const loop = createTickLoop({
    runTick: async () => {
      runs += 1;
    },
    intervalMs: 1000
  });

  assert.equal(await loop.tick(), true);
  assert.equal(await loop.tick(), true);
  assert.equal(runs, 2, 'sequential ticks both run');
  assert.equal(loop.isRunning(), false);
});

test('a throwing tick is caught, logged, and clears the running flag', async () => {
  let calls = 0;
  const errors = [];
  const loop = createTickLoop({
    runTick: async () => {
      calls += 1;
      if (calls === 1) throw new Error('boom');
    },
    intervalMs: 1000,
    logger: { error: (o) => errors.push(o) }
  });

  assert.equal(await loop.tick(), false, 'the failing tick returns false');
  assert.equal(errors.length, 1, 'the error is logged');
  assert.equal(loop.isRunning(), false, 'running is reset after a throw');
  assert.equal(await loop.tick(), true, 'the loop recovers on the next tick');
});

test('stop() halts the interval so no further ticks are scheduled', async () => {
  let runs = 0;
  const loop = createTickLoop({
    runTick: async () => {
      runs += 1;
    },
    intervalMs: 5
  });

  loop.start(); // fires an immediate tick, then schedules the interval
  loop.stop();
  const after = runs;

  await new Promise((r) => setTimeout(r, 30));
  assert.equal(runs, after, 'no ticks fire after stop()');
});
