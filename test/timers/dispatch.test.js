import test from 'node:test';
import assert from 'node:assert/strict';
import { createDispatch } from '../../src/timers/dispatch.js';
import { renderMessage } from '../../src/timers/messages.js';

function fakeChannel(id) {
  const sends = [];
  return { _id: id, isTextBased: () => true, send: async (p) => sends.push(p), sends };
}
function fakeMember(id, bot = false) {
  const dms = [];
  return { id, user: { bot }, send: async (b) => dms.push(b), dms };
}
function fakeRole(id, members) {
  return { _id: id, members: new Map(members.map((m) => [m.id, m])) };
}
function fakeGuild(id, channel, role) {
  return {
    id,
    channels: {
      cache: { get: (c) => (channel && c === channel._id ? channel : undefined) },
      fetch: async () => null
    },
    roles: {
      cache: { get: (r) => (role && r === role._id ? role : undefined) },
      fetch: async () => null
    }
  };
}
function fakeClient(guilds) {
  return { guilds: { cache: new Map(guilds.map((g) => [g.id, g])) } };
}

/** Build a fresh 3-guild world; gA enabled, gB has AGM off, gC not set up. */
function makeWorld({ dmEnabled = true } = {}) {
  const chA = fakeChannel('cA');
  const chB = fakeChannel('cB');
  const u1 = fakeMember('u1', false);
  const b1 = fakeMember('b1', true);
  const roleA = fakeRole('rA', [u1, b1]);
  const roleB = fakeRole('rB', []);

  const client = fakeClient([
    fakeGuild('gA', chA, roleA),
    fakeGuild('gB', chB, roleB),
    fakeGuild('gC', null, null)
  ]);

  const configs = {
    gA: {
      alertChannelId: 'cA',
      alertRoleId: 'rA',
      dmEnabled,
      timers: { bg: true, agm: true, dmf: true, stv: true }
    },
    gB: {
      alertChannelId: 'cB',
      alertRoleId: 'rB',
      dmEnabled: true,
      timers: { bg: true, agm: false, dmf: true, stv: true } // AGM off here
    },
    gC: { alertChannelId: null, alertRoleId: null, dmEnabled: true, timers: {} } // not set up
  };
  const loadConfig = async (id) => configs[id];

  return { client, loadConfig, chA, chB, u1, b1 };
}

test('AGM warning: pings + DMs the enabled guild, skips disabled/unconfigured', async () => {
  const w = makeWorld();
  const dispatch = createDispatch(w.client, { loadConfig: w.loadConfig });

  await dispatch({
    event: 'agm',
    kind: 'warning',
    policy: { channel: 'ping', dm: true },
    state: {}
  });

  const warn = renderMessage('agm', 'warning');
  assert.deepEqual(w.chA.sends, [
    { content: `${warn} <@&rA>`, allowedMentions: { roles: ['rA'] } }
  ]);
  assert.deepEqual(w.u1.dms, [warn]); // role holder DMed
  assert.deepEqual(w.b1.dms, []); // bot skipped
  assert.deepEqual(w.chB.sends, []); // AGM disabled in gB
});

test('AGM spawn: silent broadcast and NO DM (the preserved asymmetry)', async () => {
  const w = makeWorld();
  const dispatch = createDispatch(w.client, { loadConfig: w.loadConfig });

  await dispatch({
    event: 'agm',
    kind: 'occurrence',
    policy: { channel: 'broadcast', dm: false },
    state: {}
  });

  const spawn = renderMessage('agm', 'occurrence');
  assert.deepEqual(w.chA.sends, [{ content: spawn, allowedMentions: { parse: [] } }]);
  assert.deepEqual(w.u1.dms, []); // dm:false => no DM fan-out
});

test('dmEnabled:false suppresses DMs but still delivers to the channel', async () => {
  const w = makeWorld({ dmEnabled: false });
  const dispatch = createDispatch(w.client, { loadConfig: w.loadConfig });

  await dispatch({
    event: 'stv',
    kind: 'warning',
    policy: { channel: 'ping', dm: true },
    state: {}
  });

  const warn = renderMessage('stv', 'warning');
  assert.deepEqual(w.chA.sends, [
    { content: `${warn} <@&rA>`, allowedMentions: { roles: ['rA'] } }
  ]);
  assert.deepEqual(w.u1.dms, []); // DMs off for the guild
});

test('BG occurrence renders per-guild rotation copy as a ping', async () => {
  const w = makeWorld();
  const dispatch = createDispatch(w.client, { loadConfig: w.loadConfig });

  const state = {
    endsInMs: 0,
    label: 'AV',
    meta: { currentBG: { name: 'Alterac Valley', shortName: 'AV' } }
  };
  await dispatch({ event: 'bg', kind: 'occurrence', policy: { channel: 'ping', dm: true }, state });

  const body = renderMessage('bg', 'occurrence', state);
  assert.deepEqual(w.chA.sends, [
    { content: `${body} <@&rA>`, allowedMentions: { roles: ['rA'] } }
  ]);
  assert.deepEqual(w.u1.dms, [body]);
});

test('onlyGuildId scopes delivery to a single guild', async () => {
  const w = makeWorld();
  const dispatch = createDispatch(w.client, { loadConfig: w.loadConfig });

  // STV is enabled in both gA and gB; scoping must exclude gB entirely.
  const results = await dispatch({
    event: 'stv',
    kind: 'warning',
    policy: { channel: 'ping', dm: true },
    state: {},
    onlyGuildId: 'gA'
  });

  const warn = renderMessage('stv', 'warning');
  assert.deepEqual(w.chA.sends, [
    { content: `${warn} <@&rA>`, allowedMentions: { roles: ['rA'] } }
  ]);
  assert.deepEqual(w.chB.sends, []); // excluded by scope
  assert.deepEqual(results, [{ guildId: 'gA', channelDelivered: true, dmsSent: 1 }]);
});

test('dispatch returns a per-guild results summary (skips disabled/unconfigured)', async () => {
  const w = makeWorld();
  const dispatch = createDispatch(w.client, { loadConfig: w.loadConfig });

  const results = await dispatch({
    event: 'agm',
    kind: 'warning',
    policy: { channel: 'ping', dm: true },
    state: {}
  });

  // gA delivers (1 non-bot DM); gB has AGM off; gC not set up.
  assert.deepEqual(results, [{ guildId: 'gA', channelDelivered: true, dmsSent: 1 }]);
});
