import test from 'node:test';
import assert from 'node:assert/strict';
import { loadCommands } from '../../src/commands/index.js';

test('/guide is registered with autocompleted slug/class and page/tag options', async () => {
  const cmds = await loadCommands();
  const cmd = cmds.get('guide');
  assert.ok(cmd, 'guide command should be registered');
  assert.equal(typeof cmd.autocomplete, 'function');

  const json = cmd.data.toJSON();
  const opt = (name) => (json.options ?? []).find((o) => o.name === name);

  assert.ok(
    opt('slug') && !opt('slug').required && opt('slug').autocomplete,
    'slug: optional + autocompleted'
  );
  assert.ok(
    opt('class') && !opt('class').required && opt('class').autocomplete,
    'class: optional + autocompleted'
  );
  assert.ok(opt('tag') && !opt('tag').required, 'tag: optional');
  const page = opt('page');
  assert.ok(page && !page.required, 'page: optional');
  assert.equal(page.type, 4, 'page is an integer option');
  assert.equal(page.min_value, 1, 'page is clamped to >= 1');
});

test('guide autocomplete routes the slug option to guide slugs', async () => {
  const cmds = await loadCommands();
  const cmd = cmds.get('guide');

  let responded;
  const interaction = {
    inGuild: () => false,
    options: { getFocused: () => ({ name: 'slug', value: '19' }), getString: () => null },
    respond: async (choices) => {
      responded = choices;
    }
  };

  await cmd.autocomplete(interaction);
  assert.ok(Array.isArray(responded));
  assert.ok(responded.length <= 25);
  const basics = responded.find((c) => c.value === '19-twink-basics');
  assert.ok(basics, 'suggests the seeded basics guide by slug prefix');
});

test('guide autocomplete routes the class option to roster classes', async () => {
  const cmds = await loadCommands();
  const cmd = cmds.get('guide');

  let responded;
  const interaction = {
    inGuild: () => false,
    options: { getFocused: () => ({ name: 'class', value: 'hun' }), getString: () => null },
    respond: async (choices) => {
      responded = choices;
    }
  };

  await cmd.autocomplete(interaction);
  const hunter = responded.find((c) => c.value === 'hunter');
  assert.ok(hunter, 'suggests hunter for the class option');
  assert.equal(hunter.name, 'Hunter');
});
