import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, readdirSync } from 'node:fs';
import os from 'node:os';
import nodePath from 'node:path';
import {
  mergeTimers,
  loadGuildConfig,
  saveGuildConfig,
  setStash,
  DEFAULT_CONFIG
} from '../../src/config/guildConfig.js';

/** Isolated per-test config dir so the real data/config is never touched. */
function tmpDir() {
  return mkdtempSync(nodePath.join(os.tmpdir(), 'twinkhub-cfg-'));
}

test('mergeTimers flips one event without clobbering its siblings', () => {
  const current = { bg: true, agm: true, dmf: true, stv: true };
  assert.deepEqual(mergeTimers(current, 'agm', false), {
    bg: true,
    agm: false,
    dmf: true,
    stv: true
  });
  // Input is not mutated.
  assert.equal(current.agm, true);
});

test('mergeTimers backfills onto a partial (or empty) current map', () => {
  assert.deepEqual(mergeTimers({}, 'stv', true), { stv: true });
  assert.deepEqual(mergeTimers(undefined, 'bg', false), { bg: false });
});

test('mergeTimers coerces the enabled flag to a strict boolean', () => {
  assert.equal(mergeTimers({}, 'dmf', 1).dmf, true);
  assert.equal(mergeTimers({}, 'dmf', 0).dmf, false);
  assert.equal(mergeTimers({}, 'dmf', undefined).dmf, false);
});

test('saveGuildConfig round-trips a field merged over defaults', async () => {
  const dir = tmpDir();
  try {
    const saved = await saveGuildConfig('g1', { alertChannelId: 'chan-1' }, { dir });
    assert.equal(saved.alertChannelId, 'chan-1');
    assert.equal(saved.dmEnabled, DEFAULT_CONFIG.dmEnabled, 'defaults are backfilled');

    const loaded = await loadGuildConfig('g1', { dir });
    assert.equal(loaded.alertChannelId, 'chan-1');
    assert.deepEqual(loaded.timers, DEFAULT_CONFIG.timers);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('concurrent saves to the same guild do not lose sibling fields', async () => {
  const dir = tmpDir();
  try {
    // Two independent writers racing on the same guild — the exact collision the
    // per-file lock fixes (e.g. the per-tick board updater vs an admin toggle).
    await Promise.all([
      saveGuildConfig('g1', { alertRoleId: 'role-1' }, { dir }),
      saveGuildConfig('g1', { timerBoard: { channelId: 'c', messageId: 'm' } }, { dir })
    ]);

    const cfg = await loadGuildConfig('g1', { dir });
    assert.equal(cfg.alertRoleId, 'role-1', 'first writer survived');
    assert.equal(cfg.timerBoard?.messageId, 'm', 'second writer survived');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('concurrent functional-patch merges read fresh under-lock state (no lost toggle)', async () => {
  const dir = tmpDir();
  try {
    // This is the mechanism setEventEnabled delegates to: a functional patch that
    // merges against the current config. Two concurrent flips to the same timers
    // map must both survive — each updater sees the other's write under the lock,
    // not a stale snapshot.
    await Promise.all([
      saveGuildConfig('g1', (cfg) => ({ timers: mergeTimers(cfg.timers, 'bg', false) }), { dir }),
      saveGuildConfig('g1', (cfg) => ({ timers: mergeTimers(cfg.timers, 'stv', false) }), { dir })
    ]);

    const cfg = await loadGuildConfig('g1', { dir });
    assert.equal(cfg.timers.bg, false, 'bg toggle survived');
    assert.equal(cfg.timers.stv, false, 'stv toggle survived');
    assert.equal(cfg.timers.agm, true, 'untouched sibling preserved');
    assert.equal(cfg.timers.dmf, true, 'untouched sibling preserved');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('setStash merges into the stash block without clobbering sibling fields', async () => {
  const dir = tmpDir();
  try {
    // Role wiring set by one flow...
    await setStash('g1', { managerRoleIds: ['mgr1'] }, { dir });
    // ...then the panel record set by a different flow must not wipe the roles.
    await setStash('g1', { channelId: 'chan-1', panelMessageIds: { browse: 'm1' } }, { dir });

    const cfg = await loadGuildConfig('g1', { dir });
    assert.deepEqual(cfg.stash.managerRoleIds, ['mgr1'], 'role wiring survived the panel write');
    assert.equal(cfg.stash.channelId, 'chan-1', 'panel channel merged in');
    assert.equal(cfg.stash.panelMessageIds.browse, 'm1', 'panel message id merged in');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('setStash(null) clears the whole stash block', async () => {
  const dir = tmpDir();
  try {
    await setStash('g1', { managerRoleIds: ['mgr1'] }, { dir });
    await setStash('g1', null, { dir });
    const cfg = await loadGuildConfig('g1', { dir });
    assert.equal(cfg.stash, null, 'stash block cleared');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('a save leaves no temp file behind', async () => {
  const dir = tmpDir();
  try {
    await saveGuildConfig('g1', { alertChannelId: 'chan-1' }, { dir });
    // The logical key `config/g1` resolves under the base dir's `config/` folder.
    const entries = readdirSync(nodePath.join(dir, 'config'));
    assert.deepEqual(entries, ['g1.json'], 'only the final file remains, no .tmp');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
