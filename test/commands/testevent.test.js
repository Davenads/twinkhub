import test from 'node:test';
import assert from 'node:assert/strict';
import { loadCommands } from '../../src/commands/index.js';

test('/testevent is discovered with event choices + optional warning flag', async () => {
  const cmds = await loadCommands();
  const cmd = cmds.get('testevent');
  assert.ok(cmd, 'testevent command should be registered');

  const json = cmd.data.toJSON();
  const byName = Object.fromEntries(json.options.map((o) => [o.name, o]));

  const eventOpt = byName.event;
  assert.ok(eventOpt?.required, 'event option is required');
  assert.deepEqual(
    eventOpt.choices.map((c) => c.value).sort(),
    ['agm', 'bg', 'dmf', 'stv']
  );

  const warnOpt = byName.warning;
  assert.ok(warnOpt, 'warning option exists');
  assert.ok(!warnOpt.required, 'warning option is optional');
});
