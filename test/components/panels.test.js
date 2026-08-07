import test from 'node:test';
import assert from 'node:assert/strict';
import { handleComponent } from '../../src/components/panels.js';
import { encodeCustomId } from '../../src/services/panels.js';

// A minimal component-interaction double: records reply/update/close calls and
// resolves to the default bracket (no guild) so handleComponent runs end-to-end
// against the real content store.
function mockInteraction(customId, values = []) {
  const calls = { reply: [], update: [], deferUpdate: 0, deleteReply: 0 };
  return {
    customId,
    values,
    inGuild: () => false,
    guildId: null,
    async reply(payload) {
      calls.reply.push(payload);
    },
    async update(payload) {
      calls.update.push(payload);
    },
    async deferUpdate() {
      calls.deferUpdate += 1;
    },
    async deleteReply() {
      calls.deleteReply += 1;
    },
    calls
  };
}

// Every component custom_id across a payload's ActionRowBuilders.
function idsOf(payload) {
  return (payload?.components ?? []).flatMap((row) =>
    row.toJSON().components.map((c) => c.custom_id)
  );
}

test('class pick opens ONE ephemeral with a build picker, follow-ups, and Close', async () => {
  const i = mockInteraction(encodeCustomId('pick', 'hub'), ['hunter']);
  await handleComponent(i);

  assert.equal(i.calls.reply.length, 1, 'a single ephemeral is opened');
  assert.equal(i.calls.update.length, 0, 'nothing is edited in place yet');
  const ids = idsOf(i.calls.reply[0]);
  assert.ok(ids.includes(encodeCustomId('build', 'hunter')), 'the build picker is present');
  assert.ok(ids.includes(encodeCustomId('ench', 'hunter')), 'the enchants follow-up is present');
  assert.ok(ids.includes(encodeCustomId('close')), 'a Close button is present');
  assert.ok(!ids.some((id) => id.startsWith('p1|back')), 'the gear view has no Back button');
});

test('a follow-up edits the SAME ephemeral in place with a Back + Close', async () => {
  const i = mockInteraction(encodeCustomId('ench', 'hunter'));
  await handleComponent(i);

  assert.equal(i.calls.update.length, 1, 'the follow-up updates in place');
  assert.equal(i.calls.reply.length, 0, 'no new ephemeral is spawned');
  const ids = idsOf(i.calls.update[0]);
  assert.ok(ids.includes(encodeCustomId('back', 'hunter')), 'Back returns to the class view');
  assert.ok(ids.includes(encodeCustomId('close')), 'a Close button is present');
  assert.ok(ids.includes(encodeCustomId('consc', 'hunter')), 'lateral follow-ups stay available');
});

test('picking a build threads the build id into the follow-up ids', async () => {
  const build = 'rogue-offense-alliance';
  const i = mockInteraction(encodeCustomId('build', 'rogue'), [build]);
  await handleComponent(i);

  assert.equal(i.calls.update.length, 1, 'the build pick edits in place');
  const ids = idsOf(i.calls.update[0]);
  assert.ok(
    ids.includes(encodeCustomId('ench', 'rogue', build)),
    'follow-ups carry the active build'
  );
  assert.ok(ids.includes(encodeCustomId('close')), 'Close is present on the gear view');
});

test('Back from a build follow-up rebuilds the gear view in place', async () => {
  const build = 'rogue-offense-alliance';
  const i = mockInteraction(encodeCustomId('back', 'rogue', build));
  await handleComponent(i);

  assert.equal(i.calls.update.length, 1, 'Back edits in place');
  const ids = idsOf(i.calls.update[0]);
  assert.ok(ids.includes(encodeCustomId('build', 'rogue')), 'the build picker returns');
  assert.ok(ids.includes(encodeCustomId('ench', 'rogue', build)), 'the active build is preserved');
});

test('Close deletes the clicker ephemeral without replying or editing', async () => {
  const i = mockInteraction(encodeCustomId('close'));
  await handleComponent(i);

  assert.equal(i.calls.deferUpdate, 1, 'the interaction is acknowledged');
  assert.equal(i.calls.deleteReply, 1, 'the ephemeral is deleted');
  assert.equal(i.calls.reply.length, 0);
  assert.equal(i.calls.update.length, 0);
});

test('a standalone panel lookup opens a fresh ephemeral with only a Close button', async () => {
  const i = mockInteraction(encodeCustomId('cons', 'potion'));
  await handleComponent(i);

  assert.equal(
    i.calls.reply.length,
    1,
    'standalone lookups reply (their button is on a public panel)'
  );
  assert.equal(i.calls.update.length, 0, 'the public panel is never edited');
  const ids = idsOf(i.calls.reply[0]);
  assert.deepEqual(ids, [encodeCustomId('close')], 'just a Close button, no Back / follow-ups');
});
