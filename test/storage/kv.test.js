import test from 'node:test';
import assert from 'node:assert/strict';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { readKey, writeKey, lockKey } from '../../src/storage/kv.js';

async function tmpBase() {
  return fs.mkdtemp(path.join(os.tmpdir(), 'twinkhub-kv-'));
}

const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

test('readKey returns null for a missing logical key', async () => {
  const baseDir = await tmpBase();
  assert.equal(await readKey('config/nope', { baseDir }), null);
});

test('writeKey resolves a logical key to <baseDir>/<key>.json and round-trips', async () => {
  const baseDir = await tmpBase();
  const value = { a: 1, nested: { b: [2, 3] } };
  await writeKey('config/g1', value, { baseDir });
  // The logical key maps to a nested JSON file under the base dir.
  const onDisk = path.join(baseDir, 'config', 'g1.json');
  assert.deepEqual(
    JSON.parse(await fs.readFile(onDisk, 'utf8')),
    value,
    'written at the mapped path'
  );
  assert.deepEqual(
    JSON.parse(await readKey('config/g1', { baseDir })),
    value,
    'reads back verbatim'
  );
});

test('writeKey creates nested key directories and leaves no temp file behind', async () => {
  const baseDir = await tmpBase();
  await writeKey('timers/latches', { agm: { warned: true } }, { baseDir });
  const entries = await fs.readdir(path.join(baseDir, 'timers'));
  assert.deepEqual(entries, ['latches.json'], 'only the final file remains, no .tmp');
});

test('resolvePath rejects absolute / traversal keys so a key cannot escape the root', async () => {
  const baseDir = await tmpBase();
  await assert.rejects(() => readKey('../escape', { baseDir }), /invalid storage key/);
  await assert.rejects(() => writeKey('/abs', {}, { baseDir }), /invalid storage key/);
  await assert.rejects(() => readKey('', { baseDir }), /invalid storage key/);
});

test('lockKey serializes overlapping critical sections on the same key', async () => {
  const order = [];
  const section = async (id, ms) => {
    order.push(`start-${id}`);
    await delay(ms);
    order.push(`end-${id}`);
  };
  // Without the lock the fast section (2) would interleave inside the slow one (1).
  await Promise.all([
    lockKey('config/x', () => section('1', 20)),
    lockKey('config/x', () => section('2', 0))
  ]);
  assert.deepEqual(order, ['start-1', 'end-1', 'start-2', 'end-2']);
});

test('lockKey allows concurrency across distinct keys', async () => {
  const order = [];
  const section = async (id, ms) => {
    order.push(`start-${id}`);
    await delay(ms);
    order.push(`end-${id}`);
  };
  await Promise.all([
    lockKey('config/slow', () => section('slow', 20)),
    lockKey('config/fast', () => section('fast', 0))
  ]);
  assert.deepEqual(order, ['start-slow', 'start-fast', 'end-fast', 'end-slow']);
});
