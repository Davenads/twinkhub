import test from 'node:test';
import assert from 'node:assert/strict';
import { loadCommands } from '../../src/commands/index.js';

test('/tierlist is registered with no options', async () => {
  const cmds = await loadCommands();
  const tierlist = cmds.get('tierlist');
  assert.ok(tierlist, 'tierlist command should be registered');

  const json = tierlist.data.toJSON();
  assert.equal((json.options ?? []).length, 0, 'tierlist takes no options');
});
