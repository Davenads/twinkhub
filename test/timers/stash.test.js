import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createStashRefresher, stashFingerprint } from '../../src/timers/stash.js';

// A fake guild exposing the channels.cache/fetch surface the refresher touches.
function fakeGuild(id, channel) {
  return {
    id,
    channels: {
      cache: { get: () => channel ?? null },
      fetch: async () => channel ?? null
    }
  };
}

function fakeClient(guilds) {
  return { guilds: { cache: { values: () => guilds.values() } } };
}

// A text channel that records edits/sends; `fetchThrows` simulates a deleted msg.
function fakeChannel({ fetchThrows } = {}) {
  const calls = { edited: 0, sent: 0 };
  return {
    calls,
    isTextBased: () => true,
    messages: {
      fetch: async () => {
        if (fetchThrows) {
          const err = new Error('Unknown Message');
          err.code = 10008;
          throw err;
        }
        return {
          id: 'msg-existing',
          edit: async () => {
            calls.edited += 1;
          }
        };
      }
    },
    send: async () => {
      calls.sent += 1;
      return { id: 'msg-new' };
    }
  };
}

const build = ({ items }) => ({ embeds: [{ n: items.length }], components: [] });
const noExpire = async () => ({ reverted: 0, itemIds: [] });
const enabled = () => true;

test('skips guilds with no configured stash channel', async () => {
  let listed = false;
  const refresh = createStashRefresher(fakeClient([fakeGuild('g1')]), {
    loadConfig: async () => ({ stash: null }),
    expire: noExpire,
    listItems: async () => {
      listed = true;
      return [];
    },
    build,
    isEnabled: enabled
  });
  const results = await refresh({ now: new Date() });
  assert.deepEqual(results, []);
  assert.equal(listed, false, 'never touches the store for an unconfigured guild');
});

test('no-ops entirely when the store is disabled', async () => {
  let loaded = false;
  const refresh = createStashRefresher(fakeClient([fakeGuild('g1', fakeChannel())]), {
    loadConfig: async () => {
      loaded = true;
      return { stash: { channelId: 'c1' } };
    },
    isEnabled: () => false
  });
  const results = await refresh({ now: new Date() });
  assert.deepEqual(results, []);
  assert.equal(loaded, false);
});

test('sweeps stale approvals then edits the panel when state changed', async () => {
  let expiredWith = null;
  const channel = fakeChannel();
  const refresh = createStashRefresher(fakeClient([fakeGuild('g1', channel)]), {
    loadConfig: async () => ({
      stash: { channelId: 'c1', panelMessageIds: { browse: 'msg-existing' }, staleApprovalDays: 7 }
    }),
    expire: async (guildId, opts) => {
      expiredWith = { guildId, ...opts };
      return { reverted: 2, itemIds: ['itm_a'] };
    },
    listItems: async () => [{ id: 'itm_a', status: 'available', remaining: 3 }],
    build,
    isEnabled: enabled
  });

  const results = await refresh({ now: new Date('2026-08-12T00:00:00Z') });
  assert.equal(expiredWith.guildId, 'g1');
  assert.equal(expiredWith.staleApprovalDays, 7, 'passes the guild override');
  assert.equal(channel.calls.edited, 1);
  assert.equal(results[0].action, 'edited');
});

test('DMs each requester whose stale approval reverted to pending', async () => {
  const dmed = [];
  const refresh = createStashRefresher(fakeClient([fakeGuild('g1', fakeChannel())]), {
    loadConfig: async () => ({
      stash: { channelId: 'c1', panelMessageIds: { browse: 'msg-existing' } }
    }),
    expire: async () => ({
      reverted: 2,
      itemIds: ['itm_a'],
      requests: [
        { id: 'r1', userId: 'u1', itemId: 'itm_a' },
        { id: 'r2', userId: 'u2', itemId: 'itm_a' }
      ]
    }),
    listItems: async () => [{ id: 'itm_a', status: 'available', remaining: 3 }],
    build,
    isEnabled: enabled,
    notify: async (_client, guildId, { req, kind }) => {
      dmed.push({ guildId, userId: req.userId, kind });
    }
  });

  await refresh({ now: new Date() });
  assert.deepEqual(dmed, [
    { guildId: 'g1', userId: 'u1', kind: 'expired' },
    { guildId: 'g1', userId: 'u2', kind: 'expired' }
  ]);
});

test('does not DM anyone when nothing reverted', async () => {
  let notified = 0;
  const refresh = createStashRefresher(fakeClient([fakeGuild('g1', fakeChannel())]), {
    loadConfig: async () => ({
      stash: { channelId: 'c1', panelMessageIds: { browse: 'msg-existing' } }
    }),
    expire: noExpire,
    listItems: async () => [{ id: 'itm_a', status: 'available', remaining: 3 }],
    build,
    isEnabled: enabled,
    notify: async () => {
      notified += 1;
    }
  });

  await refresh({ now: new Date() });
  assert.equal(notified, 0);
});

test('skips the edit when the fingerprint is unchanged (throttle)', async () => {
  const channel = fakeChannel();
  const items = [{ id: 'itm_a', status: 'available', remaining: 3 }];
  const refresh = createStashRefresher(fakeClient([fakeGuild('g1', channel)]), {
    loadConfig: async () => ({
      stash: { channelId: 'c1', panelMessageIds: { browse: 'msg-existing' } }
    }),
    expire: noExpire,
    listItems: async () => items,
    build,
    isEnabled: enabled
  });

  const first = await refresh({ now: new Date() });
  assert.equal(first[0].action, 'edited');
  assert.equal(channel.calls.edited, 1);

  const second = await refresh({ now: new Date() });
  assert.equal(second[0].action, 'unchanged');
  assert.equal(channel.calls.edited, 1, 'no second edit for identical state');
});

test('reposts and re-persists the id when the stored message was deleted', async () => {
  const channel = fakeChannel({ fetchThrows: true });
  let saved = null;
  const refresh = createStashRefresher(fakeClient([fakeGuild('g1', channel)]), {
    loadConfig: async () => ({
      stash: { channelId: 'c1', panelMessageIds: { browse: 'gone' } }
    }),
    saveStash: async (guildId, patch) => {
      saved = { guildId, patch };
    },
    expire: noExpire,
    listItems: async () => [{ id: 'itm_a', status: 'available', remaining: 1 }],
    build,
    isEnabled: enabled
  });

  const results = await refresh({ now: new Date() });
  assert.equal(channel.calls.sent, 1);
  assert.equal(results[0].action, 'reposted');
  assert.deepEqual(saved, { guildId: 'g1', patch: { panelMessageIds: { browse: 'msg-new' } } });
});

test('one guild throwing does not stall the others', async () => {
  const good = fakeChannel();
  const refresh = createStashRefresher(
    fakeClient([fakeGuild('bad', fakeChannel()), fakeGuild('good', good)]),
    {
      loadConfig: async () => ({ stash: { channelId: 'c1', panelMessageIds: { browse: 'm' } } }),
      expire: async (guildId) => {
        if (guildId === 'bad') throw new Error('db down');
        return { reverted: 0, itemIds: [] };
      },
      listItems: async () => [{ id: 'itm_a', status: 'available', remaining: 1 }],
      build,
      isEnabled: enabled
    }
  );

  const results = await refresh({ now: new Date() });
  assert.equal(results.find((r) => r.guildId === 'bad').action, 'error');
  assert.equal(results.find((r) => r.guildId === 'good').action, 'edited');
  assert.equal(good.calls.edited, 1);
});

test('stashFingerprint reflects status and remaining changes', () => {
  const a = stashFingerprint([{ id: 'x', status: 'available', remaining: 2 }]);
  const b = stashFingerprint([{ id: 'x', status: 'requested', remaining: 2 }]);
  const c = stashFingerprint([{ id: 'x', status: 'available', remaining: 1 }]);
  assert.notEqual(a, b);
  assert.notEqual(a, c);
  assert.equal(a, stashFingerprint([{ id: 'x', status: 'available', remaining: 2 }]));
});
