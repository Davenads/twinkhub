import { test, beforeEach, after } from 'node:test';
import assert from 'node:assert/strict';
import { createPool } from '../../src/stash/db.js';
import { addItem, requestItem, approveRequest, shutdown } from '../../src/stash/store.js';

const DATABASE_URL = process.env.DATABASE_URL;
const GUILD = 'test_guild_stash';

// Integration-only. Skipped by the default `npm test` (no DATABASE_URL); runs
// under `npm run test:int` against the dev Supabase / an ephemeral Postgres. The
// headline case is the oversell race: the whole reason we chose Postgres over a
// spreadsheet backend.
if (!DATABASE_URL) {
  test('stash store (integration)', { skip: true }, () => {});
} else {
  // Small dedicated pool for seeding/teardown; keeps the remote connection
  // footprint low alongside the store's own pool during the race tests.
  const cleanup = createPool(DATABASE_URL, { max: 2 });

  after(async () => {
    await cleanup.query('delete from stash_items where guild_id = $1', [GUILD]);
    await cleanup.end();
    await shutdown();
  });

  beforeEach(async () => {
    // stash_requests cascades from stash_items on delete.
    await cleanup.query('delete from stash_items where guild_id = $1', [GUILD]);
  });

  async function seedRequests(itemId, n) {
    const reqs = [];
    for (let i = 0; i < n; i += 1) {
      // Distinct users so each request is allowed (one open request per user+item).
      reqs.push(await requestItem(GUILD, itemId, `racer_${i}`, { requestCap: 100 }));
    }
    return reqs;
  }

  test('quantity=1: exactly one concurrent approval wins, rest get NO_STOCK', async () => {
    const item = await addItem(GUILD, { name: 'Singleton', quantity: 1 });
    const reqs = await seedRequests(item.id, 20);

    const results = await Promise.allSettled(reqs.map((r) => approveRequest(GUILD, r.id, 'mgr')));
    const approved = results.filter((r) => r.status === 'fulfilled');
    const noStock = results.filter((r) => r.status === 'rejected' && r.reason?.code === 'NO_STOCK');

    assert.equal(approved.length, 1, 'exactly one approval should succeed');
    assert.equal(noStock.length, 19, 'the other 19 should fail with NO_STOCK');
  });

  test('quantity=3: exactly three concurrent approvals win', async () => {
    const item = await addItem(GUILD, { name: 'Triple', quantity: 3 });
    const reqs = await seedRequests(item.id, 20);

    const results = await Promise.allSettled(reqs.map((r) => approveRequest(GUILD, r.id, 'mgr')));
    const approved = results.filter((r) => r.status === 'fulfilled').length;
    const noStock = results.filter(
      (r) => r.status === 'rejected' && r.reason?.code === 'NO_STOCK'
    ).length;

    assert.equal(approved, 3, 'exactly three approvals should succeed');
    assert.equal(noStock, 17, 'the other 17 should fail with NO_STOCK');
  });

  test('requestItem is idempotent per user + item', async () => {
    const item = await addItem(GUILD, { name: 'Idem', quantity: 5 });
    const a = await requestItem(GUILD, item.id, 'u1');
    const b = await requestItem(GUILD, item.id, 'u1');
    assert.equal(a.id, b.id, 'a re-click returns the same request');
  });

  test('requestItem enforces the per-user open-request cap', async () => {
    const items = [];
    for (let i = 0; i < 4; i += 1) {
      items.push(await addItem(GUILD, { name: `Cap ${i}`, quantity: 5 }));
    }
    await requestItem(GUILD, items[0].id, 'capuser', { requestCap: 3 });
    await requestItem(GUILD, items[1].id, 'capuser', { requestCap: 3 });
    await requestItem(GUILD, items[2].id, 'capuser', { requestCap: 3 });
    await assert.rejects(
      () => requestItem(GUILD, items[3].id, 'capuser', { requestCap: 3 }),
      (e) => e.code === 'CAP_REACHED'
    );
  });
}
