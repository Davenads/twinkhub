import test from 'node:test';
import assert from 'node:assert/strict';
import { loadCommands } from '../../src/commands/index.js';

test('/enchant is registered with optional autocompleted slot and class filters', async () => {
  const cmds = await loadCommands();
  const cmd = cmds.get('enchant');
  assert.ok(cmd, 'enchant command should be registered');
  assert.equal(typeof cmd.autocomplete, 'function', 'exports an autocomplete handler');

  const json = cmd.data.toJSON();
  const opt = (name) => (json.options ?? []).find((o) => o.name === name);

  assert.ok(opt('slot').autocomplete && !opt('slot').required, 'slot: optional + autocompleted');
  assert.ok(opt('class').autocomplete && !opt('class').required, 'class: optional + autocompleted');
});

// Builds a fake autocomplete interaction whose focused option is `name` with the
// typed `value`; inGuild:false avoids a disk config lookup (defaults to "19").
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

test('enchant autocomplete suggests enchant slots when the slot option is focused', async () => {
  const cmds = await loadCommands();
  const cmd = cmds.get('enchant');

  const { interaction, get } = fakeAutocomplete('slot', 'we');
  await cmd.autocomplete(interaction);

  const choices = get();
  assert.ok(Array.isArray(choices));
  assert.ok(choices.some((c) => c.value === 'weapon'));
  assert.ok(choices.every((c) => c.value.includes('we')));
});

test('enchant autocomplete suggests roster classes when the class option is focused', async () => {
  const cmds = await loadCommands();
  const cmd = cmds.get('enchant');

  const { interaction, get } = fakeAutocomplete('class', 'hu');
  await cmd.autocomplete(interaction);

  const choices = get();
  assert.ok(choices.some((c) => c.value === 'hunter' && c.name === 'Hunter'));
});
