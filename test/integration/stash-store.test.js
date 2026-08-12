import { test, beforeEach, after } from 'node:test';
import assert from 'node:assert/strict';
import { createPool } from '../../src/stash/db.js';
import {
  addItem,
  requestItem,
  approveRequest,
  markSent,
  denyRequest,
  cancelRequest,
  removeItem,
  expireStaleApprovals,
  getItem,
  listItems,
  listRequests,
  shutdown
} from '../../src/stash/store.js';

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

  test('markSent decrements remaining and flips item to given at zero', async () => {
    const item = await addItem(GUILD, { name: 'Sendable', quantity: 1 });
    const req = await requestItem(GUILD, item.id, 'buyer');
    await approveRequest(GUILD, req.id, 'mgr');
    const sent = await markSent(GUILD, req.id, 'mgr');
    assert.equal(sent.status, 'sent');

    const after = await getItem(GUILD, item.id);
    assert.equal(after.remaining, 0);
    assert.equal(after.status, 'given');
  });

  test('accounting fix: after a send a fresh request can still take the 2nd unit', async () => {
    const item = await addItem(GUILD, { name: 'TwoUnits', quantity: 2 });
    const r1 = await requestItem(GUILD, item.id, 'first');
    await approveRequest(GUILD, r1.id, 'mgr');
    await markSent(GUILD, r1.id, 'mgr');

    // One unit remains. A brand new request must be approvable — this is the
    // regression that the approved-only reserved count guards against.
    const r2 = await requestItem(GUILD, item.id, 'second');
    const approved = await approveRequest(GUILD, r2.id, 'mgr');
    assert.equal(approved.status, 'approved');

    const after = await getItem(GUILD, item.id);
    assert.equal(after.remaining, 1);
    assert.equal(after.status, 'requested'); // last unit now reserved
  });

  test('denyRequest frees a reserved unit back to available', async () => {
    const item = await addItem(GUILD, { name: 'Deniable', quantity: 1 });
    const req = await requestItem(GUILD, item.id, 'hopeful');
    await approveRequest(GUILD, req.id, 'mgr');
    assert.equal((await getItem(GUILD, item.id)).status, 'requested');

    const denied = await denyRequest(GUILD, req.id, 'mgr');
    assert.equal(denied.status, 'denied');
    assert.equal((await getItem(GUILD, item.id)).status, 'available');
  });

  test('cancelRequest is ownership-gated and frees the unit', async () => {
    const item = await addItem(GUILD, { name: 'Cancelable', quantity: 1 });
    const req = await requestItem(GUILD, item.id, 'owner');
    await approveRequest(GUILD, req.id, 'mgr');

    await assert.rejects(
      () => cancelRequest(GUILD, req.id, 'someone_else'),
      (e) => e.code === 'NOT_OWNER'
    );

    const cancelled = await cancelRequest(GUILD, req.id, 'owner');
    assert.equal(cancelled.status, 'cancelled');
    assert.equal((await getItem(GUILD, item.id)).status, 'available');
  });

  test('removeItem withdraws the item and cancels open requests', async () => {
    const item = await addItem(GUILD, { name: 'Withdrawn', quantity: 3 });
    const rPending = await requestItem(GUILD, item.id, 'p');
    const rApproved = await requestItem(GUILD, item.id, 'a');
    await approveRequest(GUILD, rApproved.id, 'mgr');

    const removed = await removeItem(GUILD, item.id, 'mgr');
    assert.equal(removed.status, 'withdrawn');

    const reqs = await listRequests(GUILD, { itemId: item.id });
    const byId = Object.fromEntries(reqs.map((r) => [r.id, r.status]));
    assert.equal(byId[rPending.id], 'cancelled');
    assert.equal(byId[rApproved.id], 'cancelled');
  });

  test('expireStaleApprovals reverts old approvals and frees the item', async () => {
    const item = await addItem(GUILD, { name: 'Stale', quantity: 1 });
    const req = await requestItem(GUILD, item.id, 'slowpoke');
    await approveRequest(GUILD, req.id, 'mgr');
    assert.equal((await getItem(GUILD, item.id)).status, 'requested');

    // decided_at is now; sweep with a future clock so it counts as stale.
    const future = new Date(Date.now() + 6 * 24 * 60 * 60 * 1000);
    const result = await expireStaleApprovals(GUILD, { staleApprovalDays: 5, now: future });
    assert.equal(result.reverted, 1);
    assert.deepEqual(result.requests, [{ id: req.id, userId: 'slowpoke', itemId: item.id }]);

    const [reverted] = await listRequests(GUILD, { itemId: item.id });
    assert.equal(reverted.status, 'pending');
    assert.equal((await getItem(GUILD, item.id)).status, 'available');
  });

  test('expireStaleApprovals leaves fresh approvals untouched', async () => {
    const item = await addItem(GUILD, { name: 'Fresh', quantity: 1 });
    const req = await requestItem(GUILD, item.id, 'prompt');
    await approveRequest(GUILD, req.id, 'mgr');

    const result = await expireStaleApprovals(GUILD, { staleApprovalDays: 5 });
    assert.equal(result.reverted, 0);
    assert.equal((await listRequests(GUILD, { itemId: item.id }))[0].status, 'approved');
  });

  test('listItems filters by status and listRequests by user', async () => {
    const a = await addItem(GUILD, { name: 'Active', quantity: 2 });
    const b = await addItem(GUILD, { name: 'Gone', quantity: 1 });
    await removeItem(GUILD, b.id, 'mgr');

    const active = await listItems(GUILD, { statuses: ['available', 'requested'] });
    const activeIds = active.map((i) => i.id);
    assert.ok(activeIds.includes(a.id), 'active item is listed');
    assert.ok(!activeIds.includes(b.id), 'withdrawn item is excluded');

    await requestItem(GUILD, a.id, 'mine');
    const mine = await listRequests(GUILD, { userId: 'mine' });
    assert.equal(mine.length, 1);
    assert.equal(mine[0].itemId, a.id);
  });
}
