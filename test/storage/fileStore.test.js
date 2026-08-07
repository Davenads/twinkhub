import test from 'node:test';
import assert from 'node:assert/strict';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { readText, writeJson, withLock } from '../../src/storage/fileStore.js';

async function tmpDir() {
  return fs.mkdtemp(path.join(os.tmpdir(), 'twinkhub-fs-'));
}

const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

test('readText returns null for a missing key', async () => {
  const dir = await tmpDir();
  assert.equal(await readText(path.join(dir, 'nope.json')), null);
});

test('readText returns file contents verbatim; parsing is the caller policy', async () => {
  const dir = await tmpDir();
  const f = path.join(dir, 'x.json');
  await fs.writeFile(f, 'not json{{{');
  // The primitive must not parse — each store decides fail-loud vs self-heal.
  assert.equal(await readText(f), 'not json{{{');
});

test('writeJson round-trips a JSON value and leaves no temp file behind', async () => {
  const dir = await tmpDir();
  const f = path.join(dir, 'data.json');
  await writeJson(f, { a: 1, b: [2, 3], c: { d: true } });
  assert.deepEqual(JSON.parse(await readText(f)), { a: 1, b: [2, 3], c: { d: true } });
  const entries = await fs.readdir(dir);
  assert.deepEqual(entries, ['data.json'], 'temp file must be renamed away, not left behind');
});

test('writeJson creates missing parent directories', async () => {
  const dir = await tmpDir();
  const f = path.join(dir, 'nested', 'deep', 'x.json');
  await writeJson(f, { ok: true });
  assert.deepEqual(JSON.parse(await readText(f)), { ok: true });
});

test('withLock serializes overlapping critical sections on the same key', async () => {
  const order = [];
  const section = async (id, ms) => {
    order.push(`start-${id}`);
    await delay(ms);
    order.push(`end-${id}`);
  };
  // Without the lock the fast section (2) would interleave inside the slow one (1).
  await Promise.all([
    withLock('/lock/key/a', () => section('1', 20)),
    withLock('/lock/key/a', () => section('2', 0))
  ]);
  assert.deepEqual(order, ['start-1', 'end-1', 'start-2', 'end-2']);
});

test('withLock allows concurrency across distinct keys', async () => {
  const order = [];
  const section = async (id, ms) => {
    order.push(`start-${id}`);
    await delay(ms);
    order.push(`end-${id}`);
  };
  // Independent keys must not contend: the fast one finishes before the slow one.
  await Promise.all([
    withLock('/lock/key/b', () => section('slow', 20)),
    withLock('/lock/key/c', () => section('fast', 0))
  ]);
  assert.deepEqual(order, ['start-slow', 'start-fast', 'end-fast', 'end-slow']);
});
