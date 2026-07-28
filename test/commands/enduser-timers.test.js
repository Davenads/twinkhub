import test from 'node:test';
import assert from 'node:assert/strict';
import { loadCommands } from '../../src/commands/index.js';

test('/events and /nextevent are discovered as option-free enduser commands', async () => {
  const cmds = await loadCommands();

  const events = cmds.get('events');
  const nextevent = cmds.get('nextevent');
  assert.ok(events, 'events command should be registered');
  assert.ok(nextevent, 'nextevent command should be registered');

  assert.equal((events.data.toJSON().options ?? []).length, 0);
  assert.equal((nextevent.data.toJSON().options ?? []).length, 0);
});
