import test from 'node:test';
import assert from 'node:assert/strict';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { loadCommands } from '../../src/commands/index.js';
import { logger } from '../../src/lib/logger.js';

/** Build a temp commands dir from a { relativePath: fileContents } map. */
async function fixtureDir(files) {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'twinkhub-cmds-'));
  // The real commands live under the project's `type: module` scope. A bare temp
  // dir has no such scope, so `.js` would parse as CommonJS and reject the ESM
  // `export` syntax. Mark the fixture dir as an ESM package so `.js` resolves the
  // same way it does in production.
  await fs.writeFile(path.join(dir, 'package.json'), '{"type":"module"}');
  for (const [rel, contents] of Object.entries(files)) {
    const full = path.join(dir, rel);
    await fs.mkdir(path.dirname(full), { recursive: true });
    await fs.writeFile(full, contents);
  }
  return dir;
}

const VALID = `export const data = { name: 'ok' };
export function execute() {}`;

const MISSING_EXECUTE = `export const data = { name: 'noexec' };`;

const MISSING_DATA = `export function execute() {}`;

const PLAIN_HELPER = `export const helper = () => 42;`;

const THROWS_ON_IMPORT = `throw new Error('boom at import');`;

test('loadCommands loads only well-formed command modules', async () => {
  const dir = await fixtureDir({
    'ok.js': VALID,
    'noexec.js': MISSING_EXECUTE,
    'nodata.js': MISSING_DATA,
    'helper.js': PLAIN_HELPER,
    'sub/index.js': VALID, // index barrels are skipped by name
    'notes.txt': 'not a js file'
  });

  const commands = await loadCommands({ dir });

  assert.deepEqual([...commands.keys()], ['ok'], 'only the valid command is registered');
  assert.equal(typeof commands.get('ok').execute, 'function');
});

test('a module that throws on import is logged and skipped, not fatal', async () => {
  const dir = await fixtureDir({
    'ok.js': VALID,
    'broken.js': THROWS_ON_IMPORT
  });

  const orig = logger.warn;
  const warned = [];
  logger.warn = (obj) => warned.push(obj);
  let commands;
  try {
    commands = await loadCommands({ dir });
  } finally {
    logger.warn = orig;
  }

  assert.deepEqual([...commands.keys()], ['ok'], 'the valid command still loads');
  assert.equal(warned.length, 1, 'the broken module is logged once');
  assert.match(warned[0].file, /broken\.js$/, 'the log names the offending file');
});

test('an empty commands dir yields an empty collection', async () => {
  const dir = await fixtureDir({});
  const commands = await loadCommands({ dir });
  assert.equal(commands.size, 0);
});
