import test from 'node:test';
import assert from 'node:assert/strict';
import { loadCommands } from '../../src/commands/index.js';

test('/alerts is registered with event choices and an enabled flag', async () => {
  const cmds = await loadCommands();
  const alerts = cmds.get('alerts');
  assert.ok(alerts, 'alerts command should be registered');

  const json = alerts.data.toJSON();
  const byName = Object.fromEntries((json.options ?? []).map((o) => [o.name, o]));

  assert.ok(byName.event?.required, 'event option is required');
  assert.deepEqual(
    (byName.event.choices ?? []).map((c) => c.value),
    ['bg', 'agm', 'dmf', 'stv']
  );
  assert.ok(byName.enabled?.required, 'enabled option is required');
});

test('/timerdms is registered with a single required enabled flag', async () => {
  const cmds = await loadCommands();
  const timerdms = cmds.get('timerdms');
  assert.ok(timerdms, 'timerdms command should be registered');

  const json = timerdms.data.toJSON();
  assert.equal((json.options ?? []).length, 1);
  assert.equal(json.options[0].name, 'enabled');
  assert.ok(json.options[0].required, 'enabled option is required');
});
