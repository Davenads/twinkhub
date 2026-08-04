import test from 'node:test';
import assert from 'node:assert/strict';
import { loadCommands } from '../../src/commands/index.js';

test('/consumable is registered with a choice type option and autocompleted class', async () => {
  const cmds = await loadCommands();
  const cmd = cmds.get('consumable');
  assert.ok(cmd, 'consumable command should be registered');
  assert.equal(typeof cmd.autocomplete, 'function');

  const json = cmd.data.toJSON();
  const opt = (name) => (json.options ?? []).find((o) => o.name === name);

  const type = opt('type');
  assert.ok(type && !type.required, 'type: optional');
  assert.deepEqual(
    (type.choices ?? []).map((c) => c.value),
    ['potion', 'poison', 'elixir', 'scroll', 'food', 'bandage', 'weapon-buff', 'explosive', 'worldbuff']
  );

  assert.ok(opt('class') && !opt('class').required && opt('class').autocomplete, 'class: optional + autocompleted');
});

test('consumable autocomplete suggests roster classes and returns the class key', async () => {
  const cmds = await loadCommands();
  const cmd = cmds.get('consumable');

  let responded;
  const interaction = {
    inGuild: () => false,
    options: {
      getFocused: () => 'rog',
      getString: () => null
    },
    respond: async (choices) => {
      responded = choices;
    }
  };

  await cmd.autocomplete(interaction);
  assert.ok(Array.isArray(responded));
  assert.ok(responded.length <= 25);
  const rogue = responded.find((c) => c.value === 'rogue');
  assert.ok(rogue, 'suggests rogue by typed prefix');
  assert.equal(rogue.name, 'Rogue');
});
