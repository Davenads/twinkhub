import test from 'node:test';
import assert from 'node:assert/strict';
import { loadCommands } from '../../src/commands/index.js';

test('/spellcoef is registered with a required autocompleted class option', async () => {
  const cmds = await loadCommands();
  const cmd = cmds.get('spellcoef');
  assert.ok(cmd, 'spellcoef command should be registered');
  assert.equal(typeof cmd.autocomplete, 'function');

  const json = cmd.data.toJSON();
  const opt = (name) => (json.options ?? []).find((o) => o.name === name);
  assert.ok(opt('class').required && opt('class').autocomplete, 'class: required + autocompleted');
});

test('spellcoef autocomplete suggests caster classes and returns the class key', async () => {
  const cmds = await loadCommands();
  const cmd = cmds.get('spellcoef');

  let responded;
  const interaction = {
    inGuild: () => false,
    options: {
      getFocused: () => 'mag',
      getString: () => null
    },
    respond: async (choices) => {
      responded = choices;
    }
  };

  await cmd.autocomplete(interaction);
  assert.ok(Array.isArray(responded));
  assert.ok(responded.length <= 25);
  const mage = responded.find((c) => c.value === 'mage');
  assert.ok(mage, 'suggests mage by typed prefix');
  assert.equal(mage.name, 'Mage');
  assert.ok(!responded.some((c) => c.value === 'warrior'), 'melee class is not suggested');
});
