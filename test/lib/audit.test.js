import test from 'node:test';
import assert from 'node:assert/strict';
import { describeChatInput, describePanel, formatAuditEntry } from '../../src/lib/audit.js';

// Option types mirrored from Discord's ApplicationCommandOptionType.
const SUB = 1;
const GROUP = 2;
const STR = 3;
const INT = 4;

const user = { id: 'U1', tag: 'twink#0001' };

function fieldValue(embed, name) {
  return embed.data.fields.find((f) => f.name === name)?.value;
}

test('describeChatInput flattens leaf options to name=value args', () => {
  const i = {
    commandName: 'talents',
    options: {
      data: [
        { name: 'class', type: STR, value: 'hunter' },
        { name: 'build', type: STR, value: 'hunter-concussive-control' }
      ]
    }
  };
  assert.deepEqual(describeChatInput(i), {
    title: '/talents',
    args: 'class=hunter build=hunter-concussive-control'
  });
});

test('describeChatInput folds a sub-command into the title', () => {
  const i = {
    commandName: 'panels',
    options: { data: [{ name: 'refresh', type: SUB, options: [] }] }
  };
  assert.deepEqual(describeChatInput(i), { title: '/panels refresh', args: '' });
});

test('describeChatInput folds group + sub-command and keeps leaf args', () => {
  const i = {
    commandName: 'cfg',
    options: {
      data: [
        {
          name: 'grp',
          type: GROUP,
          options: [{ name: 'sub', type: SUB, options: [{ name: 'n', type: INT, value: 3 }] }]
        }
      ]
    }
  };
  assert.deepEqual(describeChatInput(i), { title: '/cfg grp sub', args: 'n=3' });
});

test('describePanel decodes a button action to a friendly label', () => {
  const i = { customId: 'p1|cons|potion' };
  assert.deepEqual(describePanel(i), { title: 'Panel: Consumables (type)', args: 'potion' });
});

test('describePanel appends chosen select values', () => {
  const i = { customId: 'p1|eslot', values: ['weapon'] };
  assert.deepEqual(describePanel(i), { title: 'Panel: Enchants (slot)', args: '\u2192 weapon' });
});

test('describePanel reports a stale/foreign id instead of dropping it', () => {
  const i = { customId: 'zz|foo|bar' };
  const out = describePanel(i);
  assert.equal(out.title, 'Panel: unknown control');
  assert.equal(out.args, 'zz|foo|bar');
});

test('describePanel decodes a stash s1 id to a Stash label', () => {
  assert.deepEqual(describePanel({ customId: 's1|refresh' }), {
    title: 'Stash: Refresh',
    args: ''
  });
});

test('describePanel appends the chosen item on a stash request select', () => {
  const i = { customId: 's1|req', values: ['itm_abc'] };
  assert.deepEqual(describePanel(i), { title: 'Stash: Request', args: '\u2192 itm_abc' });
});

test('formatAuditEntry builds a success embed with brand color and OK outcome', () => {
  const i = {
    commandName: 'talents',
    user,
    channelId: 'C9',
    guildId: 'G1',
    id: 'INT1',
    options: { data: [{ name: 'class', type: STR, value: 'hunter' }] }
  };
  const embed = formatAuditEntry({
    kind: 'command',
    interaction: i,
    outcome: { ok: true },
    ms: 12
  });
  assert.equal(embed.data.title, '/talents');
  assert.equal(embed.data.color, 0xc8aa6e);
  assert.equal(fieldValue(embed, 'Args'), 'class=hunter');
  assert.equal(fieldValue(embed, 'User'), '<@U1> (U1)');
  assert.equal(fieldValue(embed, 'Channel'), '<#C9>');
  assert.equal(fieldValue(embed, 'Outcome'), 'OK');
  assert.equal(fieldValue(embed, 'Latency'), '12 ms');
});

test('formatAuditEntry marks a failed interaction red with the error message', () => {
  const i = { customId: 'p1|talents|hunter', user, channelId: 'C9', guildId: 'G1', id: 'INT2' };
  const embed = formatAuditEntry({
    kind: 'panel',
    interaction: i,
    outcome: { ok: false, error: new Error('boom') },
    ms: 4
  });
  assert.equal(embed.data.color, 0xed4245);
  assert.equal(embed.data.title, 'Panel: Talents');
  assert.equal(fieldValue(embed, 'Outcome'), 'Error: boom');
});

test('formatAuditEntry falls back to em dash for empty args and marks DMs', () => {
  const i = { commandName: 'pets', user, options: { data: [] } };
  const embed = formatAuditEntry({ kind: 'command', interaction: i, outcome: { ok: true } });
  assert.equal(fieldValue(embed, 'Args'), '\u2014');
  assert.equal(fieldValue(embed, 'Channel'), 'Direct message');
  assert.equal(fieldValue(embed, 'Latency'), '\u2014');
});
