import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  buildRequestNotice,
  notifyNewRequest,
  buildRequesterDM,
  notifyRequester
} from '../../src/stash/notify.js';

const req = { id: 'req_1', itemId: 'itm_a' };

test('buildRequestNotice pings only the given manager roles', () => {
  const p = buildRequestNotice({
    item: { name: 'Whipper Root Tuber', remaining: 3 },
    req,
    requesterId: 'u1',
    managerRoleIds: ['r1', 'r2']
  });
  assert.deepEqual(p.allowedMentions, { roles: ['r1', 'r2'] });
  assert.match(p.content, /<@&r1> <@&r2>/);
  assert.equal(p.embeds.length, 1);
});

test('buildRequestNotice embed carries item, requester, id, and approve hint', () => {
  const p = buildRequestNotice({
    item: { name: 'Arena Grand Master', remaining: 1 },
    req,
    requesterId: 'u9',
    managerRoleIds: []
  });
  const fields = p.embeds[0].data.fields;
  const byName = Object.fromEntries(fields.map((f) => [f.name, f.value]));
  assert.match(byName.Item, /Arena Grand Master/);
  assert.match(byName.Item, /1 left/);
  assert.equal(byName.Requester, '<@u9>');
  assert.equal(byName['Request id'], '`req_1`');
  assert.match(byName.Approve, /\/stashadmin approve request_id:req_1/);
  // No roles => no role pings allowed.
  assert.deepEqual(p.allowedMentions, { roles: [] });
});

test('buildRequestNotice falls back to the item id when item is null', () => {
  const p = buildRequestNotice({ item: null, req, requesterId: 'u1', managerRoleIds: [] });
  const item = p.embeds[0].data.fields.find((f) => f.name === 'Item').value;
  assert.match(item, /itm_a/);
});

test('notifyNewRequest no-ops when no manager channel is configured', async () => {
  let sent = 0;
  await notifyNewRequest(
    {},
    'g1',
    { req, requesterId: 'u1' },
    {
      loadConfig: async () => ({ stash: { managerRoleIds: ['r1'] } }),
      getItem: async () => ({ name: 'X', remaining: 1 }),
      send: async () => {
        sent += 1;
      }
    }
  );
  assert.equal(sent, 0);
});

test('notifyNewRequest sends to the configured channel with the built payload', async () => {
  let captured = null;
  await notifyNewRequest(
    {},
    'g1',
    { req, requesterId: 'u1' },
    {
      loadConfig: async () => ({
        stash: { managerChannelId: 'chan1', managerRoleIds: ['r1'] }
      }),
      getItem: async () => ({ name: 'Lung Juice Cocktail', remaining: 2 }),
      send: async (channelId, payload) => {
        captured = { channelId, payload };
      }
    }
  );
  assert.equal(captured.channelId, 'chan1');
  assert.deepEqual(captured.payload.allowedMentions, { roles: ['r1'] });
  const item = captured.payload.embeds[0].data.fields.find((f) => f.name === 'Item').value;
  assert.match(item, /Lung Juice Cocktail/);
});

test('notifyNewRequest swallows a send failure (never throws)', async () => {
  await assert.doesNotReject(
    notifyNewRequest(
      {},
      'g1',
      { req, requesterId: 'u1' },
      {
        loadConfig: async () => ({ stash: { managerChannelId: 'chan1' } }),
        getItem: async () => null,
        send: async () => {
          throw new Error('missing perms');
        }
      }
    )
  );
});

test('notifyNewRequest swallows a getItem failure and still sends with fallback', async () => {
  let captured = null;
  await notifyNewRequest(
    {},
    'g1',
    { req, requesterId: 'u1' },
    {
      loadConfig: async () => ({ stash: { managerChannelId: 'chan1', managerRoleIds: [] } }),
      getItem: async () => {
        throw new Error('db blip');
      },
      send: async (channelId, payload) => {
        captured = payload;
      }
    }
  );
  const item = captured.embeds[0].data.fields.find((f) => f.name === 'Item').value;
  assert.match(item, /itm_a/);
});

test('buildRequesterDM writes decision copy with item name and request id', () => {
  const item = { name: 'Whipper Root Tuber' };
  const approved = buildRequesterDM({ kind: 'approved', item, req });
  assert.match(approved.content, /Whipper Root Tuber/);
  assert.match(approved.content, /approved/);
  assert.match(approved.content, /req_1/);
  assert.deepEqual(approved.allowedMentions, { parse: [] });

  const sent = buildRequesterDM({ kind: 'sent', item, req });
  assert.match(sent.content, /sent/);
  const denied = buildRequesterDM({ kind: 'denied', item, req });
  assert.match(denied.content, /denied/);
});

test('buildRequesterDM falls back to the item id when item is null', () => {
  const p = buildRequesterDM({ kind: 'approved', item: null, req });
  assert.match(p.content, /itm_a/);
});

test('buildRequesterDM returns null for an unknown kind', () => {
  assert.equal(buildRequesterDM({ kind: 'nope', item: null, req }), null);
});

test('notifyRequester DMs the request owner with the built payload', async () => {
  let captured = null;
  await notifyRequester(
    {},
    'g1',
    { req: { ...req, userId: 'u7' }, kind: 'approved' },
    {
      getItem: async () => ({ name: 'Lung Juice Cocktail' }),
      dmUser: async (userId, payload) => {
        captured = { userId, payload };
      }
    }
  );
  assert.equal(captured.userId, 'u7');
  assert.match(captured.payload.content, /Lung Juice Cocktail/);
  assert.match(captured.payload.content, /approved/);
});

test('notifyRequester no-ops for an unknown kind', async () => {
  let called = false;
  await notifyRequester(
    {},
    'g1',
    { req: { ...req, userId: 'u7' }, kind: 'nope' },
    {
      getItem: async () => ({ name: 'X' }),
      dmUser: async () => {
        called = true;
      }
    }
  );
  assert.equal(called, false);
});

test('notifyRequester swallows a DM failure (never throws)', async () => {
  await assert.doesNotReject(
    notifyRequester(
      {},
      'g1',
      { req: { ...req, userId: 'u7' }, kind: 'denied' },
      {
        getItem: async () => null,
        dmUser: async () => {
          throw new Error('cannot send to this user');
        }
      }
    )
  );
});

test('notifyRequester swallows a getItem failure and still DMs with fallback', async () => {
  let captured = null;
  await notifyRequester(
    {},
    'g1',
    { req: { ...req, userId: 'u7' }, kind: 'sent' },
    {
      getItem: async () => {
        throw new Error('db blip');
      },
      dmUser: async (userId, payload) => {
        captured = payload;
      }
    }
  );
  assert.match(captured.content, /itm_a/);
});
