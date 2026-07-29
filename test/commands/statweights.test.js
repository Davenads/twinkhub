import test from 'node:test';
import assert from 'node:assert/strict';
import { loadCommands } from '../../src/commands/index.js';

test('/statweights is registered with a required autocompleted class option', async () => {
  const cmds = await loadCommands();
  const cmd = cmds.get('statweights');
  assert.ok(cmd, 'statweights command should be registered');
  assert.equal(typeof cmd.autocomplete, 'function');

  const json = cmd.data.toJSON();
  const opt = (name) => (json.options ?? []).find((o) => o.name === name);
  assert.ok(opt('class').required && opt('class').autocomplete, 'class: required + autocompleted');
  assert.ok(opt('bracket') && !opt('bracket').required, 'bracket: optional');
});

test('statweights autocomplete suggests scaling classes and returns the class key', async () => {
  const cmds = await loadCommands();
  const cmd = cmds.get('statweights');

  let responded;
  const interaction = {
    inGuild: () => false,
    options: {
      getFocused: () => 'hun',
      getString: () => null
    },
    respond: async (choices) => {
      responded = choices;
    }
  };

  await cmd.autocomplete(interaction);
  assert.ok(Array.isArray(responded));
  assert.ok(responded.length <= 25);
  const hunter = responded.find((c) => c.value === 'hunter');
  assert.ok(hunter, 'suggests hunter by typed prefix');
  assert.equal(hunter.name, 'Hunter');
});
