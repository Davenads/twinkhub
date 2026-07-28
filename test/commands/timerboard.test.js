import test from 'node:test';
import assert from 'node:assert/strict';
import { ChannelType } from 'discord.js';
import { loadCommands } from '../../src/commands/index.js';

test('/timerboard exposes set (required text channel) and off subcommands', async () => {
  const cmds = await loadCommands();
  const board = cmds.get('timerboard');
  assert.ok(board, 'timerboard command should be registered');

  const json = board.data.toJSON();
  const subs = Object.fromEntries((json.options ?? []).map((o) => [o.name, o]));

  assert.ok(subs.set, 'has a set subcommand');
  assert.ok(subs.off, 'has an off subcommand');

  const channelOpt = (subs.set.options ?? []).find((o) => o.name === 'channel');
  assert.ok(channelOpt, 'set has a channel option');
  assert.ok(channelOpt.required, 'channel option is required');
  assert.ok(
    (channelOpt.channel_types ?? []).includes(ChannelType.GuildText),
    'channel option is restricted to text channels'
  );

  // off takes no options.
  assert.equal((subs.off.options ?? []).length, 0);
});
