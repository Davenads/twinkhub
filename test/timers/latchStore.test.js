import test from 'node:test';
import assert from 'node:assert/strict';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { loadLatches, saveLatches } from '../../src/timers/latchStore.js';

async function tmpFile() {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'twinkhub-latch-'));
  return path.join(dir, 'latches.json');
}

test('loadLatches: missing file returns an empty map (clean seed)', async () => {
  const f = await tmpFile();
  assert.deepEqual(await loadLatches(f), {});
});

test('loadLatches: corrupt (zero-filled) file re-seeds instead of throwing', async () => {
  const f = await tmpFile();
  await fs.writeFile(f, '\u0000\u0000\u0000\u0000\u0000\u0000');
  const orig = console.warn;
  let warned = 0;
  console.warn = () => {
    warned++;
  };
  try {
    assert.deepEqual(await loadLatches(f), {});
  } finally {
    console.warn = orig;
  }
  assert.equal(warned, 1, 'should warn once about the corruption');
});

test('saveLatches round-trips and leaves no temp file behind', async () => {
  const f = await tmpFile();
  await saveLatches({ agm: { wasActive: true }, stv: { warned: false } }, f);
  assert.deepEqual(await loadLatches(f), { agm: { wasActive: true }, stv: { warned: false } });
  const entries = await fs.readdir(path.dirname(f));
  assert.deepEqual(entries, ['latches.json'], 'temp file must be renamed away, not left behind');
});
