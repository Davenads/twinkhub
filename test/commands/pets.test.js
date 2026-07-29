import test from 'node:test';
import assert from 'node:assert/strict';
import { loadCommands } from '../../src/commands/index.js';

test('/pets is registered with optional autocompleted family and bracket options', async () => {
  const cmds = await loadCommands();
  const cmd = cmds.get('pets');
  assert.ok(cmd, 'pets command should be registered');
  assert.equal(typeof cmd.autocomplete, 'function');

  const json = cmd.data.toJSON();
  const opt = (name) => (json.options ?? []).find((o) => o.name === name);
  assert.ok(opt('family') && !opt('family').required && opt('family').autocomplete, 'family: optional + autocompleted');
  assert.ok(opt('bracket') && !opt('bracket').required, 'bracket: optional');
});

test('pets autocomplete suggests the seeded families and returns the family key', async () => {
  const cmds = await loadCommands();
  const cmd = cmds.get('pets');

  let responded;
  const interaction = {
    inGuild: () => false,
    options: {
      getFocused: () => '',
      getString: () => null
    },
    respond: async (choices) => {
      responded = choices;
    }
  };

  await cmd.autocomplete(interaction);
  assert.ok(Array.isArray(responded));
  assert.ok(responded.length <= 25);
  const boar = responded.find((c) => c.value === 'boar');
  assert.ok(boar, 'suggests the boar family');
  assert.equal(boar.name, 'Boar');
  assert.ok(responded.some((c) => c.value === 'wind-serpent' && c.name === 'Wind Serpent'));
});
