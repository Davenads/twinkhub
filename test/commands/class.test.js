import test from 'node:test';
import assert from 'node:assert/strict';
import { loadCommands } from '../../src/commands/index.js';

test('/class is registered with a required autocompleted class option', async () => {
  const cmds = await loadCommands();
  const cmd = cmds.get('class');
  assert.ok(cmd, 'class command should be registered');
  assert.equal(typeof cmd.autocomplete, 'function', 'exports an autocomplete handler');

  const json = cmd.data.toJSON();
  const classOpt = (json.options ?? []).find((o) => o.name === 'class');
  assert.ok(classOpt, 'has a class option');
  assert.ok(classOpt.required, 'class option is required');
  assert.ok(classOpt.autocomplete, 'class option is autocompleted');
});

test('class autocomplete suggests roster classes matching the typed prefix', async () => {
  const cmds = await loadCommands();
  const cmd = cmds.get('class');

  let responded;
  const interaction = {
    inGuild: () => false, // avoid disk config lookup; defaults to primary "19"
    options: {
      getFocused: () => 'hu',
      getString: () => null
    },
    respond: async (choices) => {
      responded = choices;
    }
  };

  await cmd.autocomplete(interaction);
  assert.ok(Array.isArray(responded));
  assert.ok(responded.length <= 25);
  assert.ok(responded.some((c) => c.value === 'hunter' && c.name === 'Hunter'));
  assert.ok(responded.every((c) => c.value.includes('hu')));
});
