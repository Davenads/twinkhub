import test from 'node:test';
import assert from 'node:assert/strict';
import { loadCommands } from '../../src/commands/index.js';

function fakeInteraction({ dev }) {
  const calls = { reply: null, deferred: false, editReply: null };
  return {
    _calls: calls,
    member: { roles: { cache: dev ? [{ name: 'dev' }] : [] } },
    inGuild: () => true,
    reply: async (payload) => {
      calls.reply = payload;
    },
    deferReply: async () => {
      calls.deferred = true;
    },
    editReply: async (payload) => {
      calls.editReply = payload;
    }
  };
}

test('/reloadcontent is registered as a no-option command', async () => {
  const cmds = await loadCommands();
  const cmd = cmds.get('reloadcontent');
  assert.ok(cmd, 'reloadcontent command should be registered');
  assert.equal(typeof cmd.execute, 'function');

  const json = cmd.data.toJSON();
  assert.ok(!json.options || json.options.length === 0, 'takes no options');
});

test('/reloadcontent is gated behind the dev role', async () => {
  const cmds = await loadCommands();
  const cmd = cmds.get('reloadcontent');

  const interaction = fakeInteraction({ dev: false });
  await cmd.execute(interaction);

  assert.ok(interaction._calls.reply?.content?.includes('dev'), 'rejects with a dev-role hint');
  assert.equal(interaction._calls.deferred, false, 'does not defer or reload for non-dev');
  assert.equal(interaction._calls.editReply, null);
});

test('/reloadcontent reloads and reports a per-bracket summary for a dev', async () => {
  const cmds = await loadCommands();
  const cmd = cmds.get('reloadcontent');

  const interaction = fakeInteraction({ dev: true });
  await cmd.execute(interaction);

  assert.equal(interaction._calls.deferred, true, 'defers the reply');
  const out = interaction._calls.editReply;
  assert.equal(typeof out, 'string');
  assert.ok(out.includes('reloaded'), 'confirms the reload');
  assert.ok(out.includes('19'), 'summarizes the 19 bracket');
});
