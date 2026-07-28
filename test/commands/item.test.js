import test from 'node:test';
import assert from 'node:assert/strict';
import { loadCommands } from '../../src/commands/index.js';

test('/item is registered with a required autocompleted name option', async () => {
  const cmds = await loadCommands();
  const cmd = cmds.get('item');
  assert.ok(cmd, 'item command should be registered');
  assert.equal(typeof cmd.autocomplete, 'function');

  const json = cmd.data.toJSON();
  const opt = (name) => (json.options ?? []).find((o) => o.name === name);
  assert.ok(opt('name').required && opt('name').autocomplete, 'name: required + autocompleted');
  assert.ok(opt('bracket') && !opt('bracket').required, 'bracket: optional');
});

test('item autocomplete matches on name and returns the item id as the value', async () => {
  const cmds = await loadCommands();
  const cmd = cmds.get('item');

  let responded;
  const interaction = {
    inGuild: () => false,
    options: {
      getFocused: () => 'goggles',
      getString: () => null
    },
    respond: async (choices) => {
      responded = choices;
    }
  };

  await cmd.autocomplete(interaction);
  assert.ok(Array.isArray(responded));
  assert.ok(responded.length <= 25);
  const goggles = responded.find((c) => c.value === 'green-tinted-goggles');
  assert.ok(goggles, 'suggests the goggles by name');
  assert.ok(goggles.name.includes('Green Tinted Goggles'));
});
