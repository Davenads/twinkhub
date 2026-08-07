import test from 'node:test';
import assert from 'node:assert/strict';
import { sendPing, sendBroadcast, sendDms } from '../../src/lib/delivery.js';

function fakeChannel() {
  const sends = [];
  return { isTextBased: () => true, send: async (p) => sends.push(p), sends };
}

test('sendPing appends the role mention and whitelists only that role', async () => {
  const ch = fakeChannel();
  await sendPing(ch, 'R1', 'Hello');
  assert.deepEqual(ch.sends, [{ content: 'Hello <@&R1>', allowedMentions: { roles: ['R1'] } }]);
});

test('sendBroadcast suppresses all mentions', async () => {
  const ch = fakeChannel();
  await sendBroadcast(ch, 'Silent post');
  assert.deepEqual(ch.sends, [{ content: 'Silent post', allowedMentions: { parse: [] } }]);
});

test('sendDms DMs non-bot members, skips bots and closed DMs', async () => {
  const dms = {};
  const mk = (id, bot, closed = false) => ({
    id,
    user: { bot },
    send: async (b) => {
      if (closed) {
        const e = new Error('Cannot send messages to this user');
        e.code = 50007;
        throw e;
      }
      (dms[id] ??= []).push(b);
    }
  });
  const role = {
    members: new Map([
      ['u1', mk('u1', false)],
      ['b1', mk('b1', true)], // bot -> skipped
      ['u2', mk('u2', false, true)], // DMs closed -> skipped, not counted
      ['u3', mk('u3', false)]
    ])
  };

  const sent = await sendDms(role, 'Ping');
  assert.equal(sent, 2);
  assert.deepEqual(dms, { u1: ['Ping'], u3: ['Ping'] });
});
