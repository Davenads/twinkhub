import test from 'node:test';
import assert from 'node:assert/strict';
import { ChannelType } from 'discord.js';
import { loadCommands } from '../../src/commands/index.js';

test('/panels exposes post (required text channel), refresh, and remove subcommands', async () => {
  const cmds = await loadCommands();
  const panels = cmds.get('panels');
  assert.ok(panels, 'panels command should be registered');

  const json = panels.data.toJSON();
  const subs = Object.fromEntries((json.options ?? []).map((o) => [o.name, o]));

  assert.ok(subs.post, 'has a post subcommand');
  assert.ok(subs.refresh, 'has a refresh subcommand');
  assert.ok(subs.remove, 'has a remove subcommand');

  const channelOpt = (subs.post.options ?? []).find((o) => o.name === 'channel');
  assert.ok(channelOpt, 'post has a channel option');
  assert.ok(channelOpt.required, 'channel option is required');
  assert.ok(
    (channelOpt.channel_types ?? []).includes(ChannelType.GuildText),
    'channel option is restricted to text channels'
  );

  // refresh and remove take no options.
  assert.equal((subs.refresh.options ?? []).length, 0);
  assert.equal((subs.remove.options ?? []).length, 0);
});
