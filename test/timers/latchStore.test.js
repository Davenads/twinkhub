import test from 'node:test';
import assert from 'node:assert/strict';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { loadLatches, saveLatches } from '../../src/timers/latchStore.js';
import { logger } from '../../src/lib/logger.js';

async function tmpBase() {
  return fs.mkdtemp(path.join(os.tmpdir(), 'twinkhub-latch-'));
}

test('loadLatches: missing file returns an empty map (clean seed)', async () => {
  const baseDir = await tmpBase();
  assert.deepEqual(await loadLatches({ baseDir }), {});
});

test('loadLatches: corrupt (zero-filled) file re-seeds instead of throwing', async () => {
  const baseDir = await tmpBase();
  // Plant a corrupt blob at the resolved key path (data root -> timers/latches.json).
  await fs.mkdir(path.join(baseDir, 'timers'), { recursive: true });
  await fs.writeFile(
    path.join(baseDir, 'timers', 'latches.json'),
    '\u0000\u0000\u0000\u0000\u0000\u0000'
  );
  const orig = logger.warn;
  let warned = 0;
  logger.warn = () => {
    warned++;
  };
  try {
    assert.deepEqual(await loadLatches({ baseDir }), {});
  } finally {
    logger.warn = orig;
  }
  assert.equal(warned, 1, 'should warn once about the corruption');
});

test('saveLatches round-trips and leaves no temp file behind', async () => {
  const baseDir = await tmpBase();
  await saveLatches({ agm: { wasActive: true }, stv: { warned: false } }, { baseDir });
  assert.deepEqual(await loadLatches({ baseDir }), {
    agm: { wasActive: true },
    stv: { warned: false }
  });
  const entries = await fs.readdir(path.join(baseDir, 'timers'));
  assert.deepEqual(entries, ['latches.json'], 'temp file must be renamed away, not left behind');
});
