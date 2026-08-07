import test from 'node:test';
import assert from 'node:assert/strict';
import { loadCommands } from '../../src/commands/index.js';

test('/quest is registered with an autocompleted class and a choice faction option', async () => {
  const cmds = await loadCommands();
  const cmd = cmds.get('quest');
  assert.ok(cmd, 'quest command should be registered');
  assert.equal(typeof cmd.autocomplete, 'function');

  const json = cmd.data.toJSON();
  const opt = (name) => (json.options ?? []).find((o) => o.name === name);

  assert.ok(
    opt('class') && !opt('class').required && opt('class').autocomplete,
    'class: optional + autocompleted'
  );
  const faction = opt('faction');
  assert.ok(faction && !faction.required, 'faction: optional');
  assert.deepEqual(
    (faction.choices ?? []).map((c) => c.value),
    ['alliance', 'horde']
  );
});

test('quest autocomplete suggests roster classes and returns the class key', async () => {
  const cmds = await loadCommands();
  const cmd = cmds.get('quest');

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
