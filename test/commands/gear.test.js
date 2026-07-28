import test from 'node:test';
import assert from 'node:assert/strict';
import { loadCommands } from '../../src/commands/index.js';

test('/gear is registered with required class, optional slot/faction/priority/bracket', async () => {
  const cmds = await loadCommands();
  const cmd = cmds.get('gear');
  assert.ok(cmd, 'gear command should be registered');
  assert.equal(typeof cmd.autocomplete, 'function');

  const json = cmd.data.toJSON();
  const opt = (name) => (json.options ?? []).find((o) => o.name === name);

  assert.ok(opt('class').required && opt('class').autocomplete, 'class: required + autocompleted');
  assert.ok(!opt('slot').required && opt('slot').autocomplete, 'slot: optional + autocompleted');

  // faction/priority use fixed choices, so they are NOT autocompleted.
  assert.ok(opt('faction') && !opt('faction').required, 'faction: optional');
  assert.ok(!opt('faction').autocomplete, 'faction: not autocompleted');
  assert.ok(opt('faction').choices?.some((c) => c.value === 'alliance'));
  assert.ok(opt('priority') && !opt('priority').required, 'priority: optional');
  assert.ok(!opt('priority').autocomplete, 'priority: not autocompleted');
  assert.ok(opt('priority').choices?.some((c) => c.value === 'core'));

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

test('gear class autocomplete suggests classes that have gear authored', async () => {
  const cmds = await loadCommands();
  const cmd = cmds.get('gear');

  const { interaction, get } = fakeAutocomplete('class', 'hun');
  await cmd.autocomplete(interaction);

  const choices = get();
  assert.ok(choices.some((c) => c.value === 'hunter' && c.name === 'Hunter'));
});

test('gear slot autocomplete suggests declared gear slots', async () => {
  const cmds = await loadCommands();
  const cmd = cmds.get('gear');

  const { interaction, get } = fakeAutocomplete('slot', 'trin');
  await cmd.autocomplete(interaction);

  const choices = get();
  assert.ok(choices.some((c) => c.value === 'trinket'));
});
