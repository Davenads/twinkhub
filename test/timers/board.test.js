import test from 'node:test';
import assert from 'node:assert/strict';
import { createBoardUpdater } from '../../src/timers/board.js';

// Injected render stub: keeps assertions decoupled from summary formatting.
const STUB = { embeds: ['STUB'] };
const render = () => ({ ...STUB });
const EXPECTED_PAYLOAD = { embeds: ['STUB'], allowedMentions: { parse: [] } };

function unknownMessageError() {
  const e = new Error('Unknown Message');
  e.code = 10008;
  return e;
}

function makeMessage(id) {
  const edits = [];
  return { id, edits, edit: async (p) => edits.push(p) };
}

/** A text channel whose fetch resolves `existing` (by id) and otherwise 10008s. */
function makeChannel(id, { existing = null, repostId = 'reposted-msg' } = {}) {
  const sends = [];
  return {
    _id: id,
    isTextBased: () => true,
    sends,
    messages: {
      fetch: async (mid) => {
        if (existing && mid === existing.id) return existing;
        throw unknownMessageError();
      }
    },
    send: async (payload) => {
      sends.push(payload);
      return makeMessage(repostId);
    }
  };
}

function makeGuild(id, channel) {
  return {
    id,
    channels: {
      cache: { get: (c) => (channel && c === channel._id ? channel : undefined) },
      fetch: async () => null
    }
  };
}

function makeClient(guilds) {
  return { guilds: { cache: new Map(guilds.map((g) => [g.id, g])) } };
}

function makeUpdater(guilds, configs) {
  const saved = [];
  const client = makeClient(guilds);
  const update = createBoardUpdater(client, {
    loadConfig: async (id) => configs[id],
    saveBoard: async (id, board) => saved.push({ id, board }),
    render,
    getStore: async () => null
  });
  return { update, saved };
}

test('edits the stored message in place when it still exists', async () => {
  const existing = makeMessage('m1');
  const ch = makeChannel('c1', { existing });
  const { update, saved } = makeUpdater([makeGuild('gA', ch)], {
    gA: { timerBoard: { channelId: 'c1', messageId: 'm1' } }
  });

  const results = await update({ states: {}, now: 1000 });

  assert.deepEqual(existing.edits, [EXPECTED_PAYLOAD]);
  assert.deepEqual(ch.sends, []); // no repost
  assert.deepEqual(saved, []); // id unchanged, no persist
  assert.deepEqual(results, [{ guildId: 'gA', action: 'edited', messageId: 'm1' }]);
});

test('reposts and persists the new id when the message was deleted', async () => {
  const ch = makeChannel('c1', { existing: null, repostId: 'fresh' });
  const { update, saved } = makeUpdater([makeGuild('gA', ch)], {
    gA: { timerBoard: { channelId: 'c1', messageId: 'gone' } }
  });

  const results = await update({ states: {}, now: 1000 });

  assert.deepEqual(ch.sends, [EXPECTED_PAYLOAD]);
  assert.deepEqual(saved, [{ id: 'gA', board: { channelId: 'c1', messageId: 'fresh' } }]);
  assert.deepEqual(results, [{ guildId: 'gA', action: 'reposted', messageId: 'fresh' }]);
});

test('a null messageId posts a fresh board and persists it', async () => {
  const ch = makeChannel('c1', { repostId: 'first' });
  const { update, saved } = makeUpdater([makeGuild('gA', ch)], {
    gA: { timerBoard: { channelId: 'c1', messageId: null } }
  });

  const results = await update({ states: {}, now: 1000 });

  assert.deepEqual(ch.sends, [EXPECTED_PAYLOAD]);
  assert.deepEqual(saved, [{ id: 'gA', board: { channelId: 'c1', messageId: 'first' } }]);
  assert.deepEqual(results, [{ guildId: 'gA', action: 'reposted', messageId: 'first' }]);
});

test('guilds without a configured board are skipped entirely', async () => {
  const ch = makeChannel('c1', { existing: makeMessage('m1') });
  const { update, saved } = makeUpdater([makeGuild('gA', ch)], {
    gA: { timerBoard: null }
  });

  const results = await update({ states: {}, now: 1000 });

  assert.deepEqual(ch.sends, []);
  assert.deepEqual(saved, []);
  assert.deepEqual(results, []);
});

test('records skipped when the board channel is missing or not text', async () => {
  // Config points at c9 but the guild has no such channel (cache miss + fetch null).
  const { update, saved } = makeUpdater([makeGuild('gA', null)], {
    gA: { timerBoard: { channelId: 'c9', messageId: 'm1' } }
  });

  const results = await update({ states: {}, now: 1000 });

  assert.deepEqual(saved, []);
  assert.deepEqual(results, [{ guildId: 'gA', action: 'skipped' }]);
});
