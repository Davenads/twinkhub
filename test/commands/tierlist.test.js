import test from 'node:test';
import assert from 'node:assert/strict';
import { loadCommands } from '../../src/commands/index.js';

test('/tierlist is registered with an optional bracket option', async () => {
  const cmds = await loadCommands();
  const tierlist = cmds.get('tierlist');
  assert.ok(tierlist, 'tierlist command should be registered');

  const json = tierlist.data.toJSON();
  const bracket = (json.options ?? []).find((o) => o.name === 'bracket');
  assert.ok(bracket, 'has a bracket option');
  assert.ok(!bracket.required, 'bracket option is optional');
});
