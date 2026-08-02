import test from 'node:test';
import assert from 'node:assert/strict';
import { loadCommands } from '../../src/commands/index.js';

test('/xprules is registered with no options', async () => {
  const cmds = await loadCommands();
  const xprules = cmds.get('xprules');
  assert.ok(xprules, 'xprules command should be registered');

  const json = xprules.data.toJSON();
  assert.equal((json.options ?? []).length, 0, 'xprules takes no options');
});
