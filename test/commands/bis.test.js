import test from 'node:test';
import assert from 'node:assert/strict';
import { loadCommands } from '../../src/commands/index.js';

test('/bis is registered with a required class and optional slot, both autocompleted', async () => {
  const cmds = await loadCommands();
  const cmd = cmds.get('bis');
  assert.ok(cmd, 'bis command should be registered');
  assert.equal(typeof cmd.autocomplete, 'function');

  const json = cmd.data.toJSON();
  const opt = (name) => (json.options ?? []).find((o) => o.name === name);

  assert.ok(opt('class').required && opt('class').autocomplete, 'class: required + autocompleted');
  assert.ok(!opt('slot').required && opt('slot').autocomplete, 'slot: optional + autocompleted');
  assert.ok(opt('bracket') && !opt('bracket').required, 'bracket: optional');
});

function fakeAutocomplete(name, value) {
  let responded;
  const interaction = {
    inGuild: () => false,
    options: {
      getFocused: (full) => (full ? { name, value } : value),
      getString: () => null
    },
    respond: async (choices) => {
      responded = choices;
    }
  };
  return { interaction, get: () => responded };
}

test('bis class autocomplete suggests classes that have a BiS authored', async () => {
  const cmds = await loadCommands();
  const cmd = cmds.get('bis');

  const { interaction, get } = fakeAutocomplete('class', 'hun');
  await cmd.autocomplete(interaction);

  const choices = get();
  assert.ok(choices.some((c) => c.value === 'hunter' && c.name === 'Hunter'));
});

test('bis slot autocomplete suggests declared gear slots', async () => {
  const cmds = await loadCommands();
  const cmd = cmds.get('bis');

  const { interaction, get } = fakeAutocomplete('slot', 'trin');
  await cmd.autocomplete(interaction);

  const choices = get();
  assert.ok(choices.some((c) => c.value === 'trinket'));
});
