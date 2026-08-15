import { test, beforeEach, after } from 'node:test';
import assert from 'node:assert/strict';
import { readdir, readFile } from 'node:fs/promises';
import { createPool } from '../../src/stash/db.js';
import {
  addItem,
  requestItem,
  approveRequest,
  markSent,
  denyRequest,
  cancelRequest,
  removeItem,
  consolidateItems,
  restockItem,
  editItem,
  findItemMatch,
  expireStaleApprovals,
  getItem,
  listItems,
  listRequests,
  shutdown
} from '../../src/stash/store.js';

const DATABASE_URL = process.env.DATABASE_URL;
const GUILD = 'test_guild_stash';

const MIGRATIONS_DIR = new URL('../../supabase/migrations/', import.meta.url);

// Provision the schema on an empty DB (the fresh CI Postgres container) so the
// store tests have tables to hit. Guarded on stash_items' existence, so an
// already-migrated dev Supabase is left untouched (non-destructive — no DROP).
// Applies every migration in filename order; the ephemeral CI DB starts empty.
async function ensureSchema(pool) {
  const { rows } = await pool.query("select to_regclass('public.stash_items') as t");
  if (rows[0].t) return;
  const files = (await readdir(MIGRATIONS_DIR)).filter((f) => f.endsWith('.sql')).sort();
  for (const file of files) {
    const sql = await readFile(new URL(file, MIGRATIONS_DIR), 'utf8');
    await pool.query(sql);
  }
}

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

  // Provision the schema before any test registers. A top-level `before` hook
  // races the first tests' beforeEach at file scope (a node:test quirk — the
  // hook isn't awaited before the earliest subtests), which left the first
  // handful failing with 42P01 on a cold DB. Awaiting here at module-eval time
  // (ESM top-level await) guarantees the tables exist before the suite runs.
  await ensureSchema(cleanup);

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

    const { item: removed, cancelled } = await removeItem(GUILD, item.id, 'mgr');
    assert.equal(removed.status, 'withdrawn');

    const cancelledById = Object.fromEntries(cancelled.map((r) => [r.id, r]));
    assert.deepEqual(cancelledById[rPending.id], {
      id: rPending.id,
      userId: 'p',
      itemId: item.id
    });
    assert.deepEqual(cancelledById[rApproved.id], {
      id: rApproved.id,
      userId: 'a',
      itemId: item.id
    });

    const reqs = await listRequests(GUILD, { itemId: item.id });
    const byId = Object.fromEntries(reqs.map((r) => [r.id, r.status]));
    assert.equal(byId[rPending.id], 'cancelled');
    assert.equal(byId[rApproved.id], 'cancelled');
  });

  test('consolidateItems folds a dupe into the survivor without cancelling requests', async () => {
    const survivor = await addItem(GUILD, { name: 'Magefist Gloves', quantity: 2 });
    const dupe = await addItem(GUILD, {
      name: 'Magefist Gloves',
      quantity: 3,
      wowheadId: '12977',
      slot: 'hands'
    });
    const rPending = await requestItem(GUILD, dupe.id, 'p');
    const rApproved = await requestItem(GUILD, dupe.id, 'a');
    await approveRequest(GUILD, rApproved.id, 'mgr');
    const rDenied = await requestItem(GUILD, dupe.id, 'd');
    await denyRequest(GUILD, rDenied.id, 'mgr');

    const res = await consolidateItems(GUILD, survivor.id, [dupe.id]);

    assert.equal(res.survivor.quantity, 5, 'quantity summed');
    assert.equal(res.survivor.remaining, 5, 'remaining summed');
    assert.equal(res.survivor.wowheadId, '12977', 'null id backfilled from the dupe');
    assert.equal(res.survivor.slot, 'hands', 'null slot backfilled from the dupe');
    assert.deepEqual(
      res.movedRequests.map((r) => r.id).sort(),
      [rPending.id, rApproved.id].sort(),
      'only the open (pending/approved) requests moved'
    );

    // Moved requests now hang off the survivor, still pending/approved (NOT cancelled).
    const onSurvivor = await listRequests(GUILD, { itemId: survivor.id });
    const survStatus = Object.fromEntries(onSurvivor.map((r) => [r.id, r.status]));
    assert.equal(survStatus[rPending.id], 'pending');
    assert.equal(survStatus[rApproved.id], 'approved');

    // Terminal history stays on the (now withdrawn) dupe row.
    const onDupe = await listRequests(GUILD, { itemId: dupe.id });
    assert.deepEqual(
      onDupe.map((r) => r.id),
      [rDenied.id],
      'only the denied history remains on the dupe'
    );
    const withdrawn = await getItem(GUILD, dupe.id);
    assert.equal(withdrawn.status, 'withdrawn');
    assert.equal(withdrawn.remaining, 0);
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

  test('findItemMatch: exact wowhead_id match wins regardless of name', async () => {
    const item = await addItem(GUILD, { name: 'Magefist Gloves', wowheadId: '12977' });
    const matches = await findItemMatch(GUILD, { wowheadId: '12977', name: 'totally different' });
    assert.equal(matches.length, 1);
    assert.equal(matches[0].id, item.id);
  });

  test('findItemMatch: normalized name match ignores case and outer whitespace', async () => {
    const item = await addItem(GUILD, { name: 'Staff of the Blessed Seer' });
    const matches = await findItemMatch(GUILD, { name: '  staff of the blessed seer ' });
    assert.equal(matches.length, 1);
    assert.equal(matches[0].id, item.id);
  });

  test('findItemMatch: a wowhead add excludes a different-id same-name row', async () => {
    await addItem(GUILD, { name: 'Ring', wowheadId: '111' });
    const conflict = await findItemMatch(GUILD, { wowheadId: '222', name: 'Ring' });
    assert.equal(conflict.length, 0, 'different id + same name is a distinct item');
  });

  test('findItemMatch: a wowhead add matches a null-id same-name row (backfill)', async () => {
    const item = await addItem(GUILD, { name: 'Cloak' });
    const matches = await findItemMatch(GUILD, { wowheadId: '333', name: 'Cloak' });
    assert.equal(matches.length, 1);
    assert.equal(matches[0].id, item.id);
  });

  test('findItemMatch: never matches a withdrawn row, and [] with no key', async () => {
    const item = await addItem(GUILD, { name: 'Gone', wowheadId: '999' });
    await removeItem(GUILD, item.id, 'mgr');
    assert.equal((await findItemMatch(GUILD, { name: 'Gone' })).length, 0);
    assert.equal((await findItemMatch(GUILD, { wowheadId: '999' })).length, 0);
    assert.equal((await findItemMatch(GUILD, {})).length, 0);
  });

  test('restockItem: bumps quantity + remaining and backfills a null id/slot', async () => {
    const item = await addItem(GUILD, { name: 'Refill', quantity: 1 });
    const out = await restockItem(GUILD, item.id, 2, { wowheadId: '4242', slot: 'waist' });
    assert.equal(out.quantity, 3);
    assert.equal(out.remaining, 3);
    assert.equal(out.wowheadId, '4242');
    assert.equal(out.slot, 'waist');
  });

  test('restockItem: never overwrites an existing id/slot (coalesce keeps them)', async () => {
    const item = await addItem(GUILD, {
      name: 'Keep',
      quantity: 1,
      wowheadId: '111',
      slot: 'head'
    });
    const out = await restockItem(GUILD, item.id, 1, { wowheadId: '222', slot: 'feet' });
    assert.equal(out.wowheadId, '111', 'existing id is retained');
    assert.equal(out.slot, 'head', 'existing slot is retained');
  });

  test('restockItem: reactivates an exhausted (given) item', async () => {
    const item = await addItem(GUILD, { name: 'Exhausted', quantity: 1 });
    const req = await requestItem(GUILD, item.id, 'taker');
    await approveRequest(GUILD, req.id, 'mgr');
    await markSent(GUILD, req.id, 'mgr');
    assert.equal((await getItem(GUILD, item.id)).status, 'given');

    const out = await restockItem(GUILD, item.id, 1);
    assert.equal(out.remaining, 1);
    assert.equal(out.status, 'available');
  });

  test('restockItem: rejects a withdrawn item, a missing item, and a bad quantity', async () => {
    const item = await addItem(GUILD, { name: 'Pulled', quantity: 1 });
    await removeItem(GUILD, item.id, 'mgr');
    await assert.rejects(
      () => restockItem(GUILD, item.id, 1),
      (e) => e.code === 'ITEM_WITHDRAWN'
    );
    await assert.rejects(
      () => restockItem(GUILD, 'itm_nope', 1),
      (e) => e.code === 'ITEM_NOT_FOUND'
    );
    const live = await addItem(GUILD, { name: 'Live', quantity: 1 });
    await assert.rejects(
      () => restockItem(GUILD, live.id, 0),
      (e) => e.code === 'INVALID_INPUT'
    );
  });

  test('editItem: renames an item (the Seet -> Seer typo case)', async () => {
    const item = await addItem(GUILD, { name: 'Staff of the Blessed Seet', slot: 'weapon' });
    const out = await editItem(GUILD, item.id, { name: 'Staff of the Blessed Seer' });
    assert.equal(out.name, 'Staff of the Blessed Seer');
    assert.equal(out.slot, 'weapon', 'an absent key is left unchanged');
  });

  test('editItem: applies only present keys and leaves quantity/remaining/status untouched', async () => {
    const item = await addItem(GUILD, { name: 'Attrs', quantity: 4, donor: 'old' });
    const out = await editItem(GUILD, item.id, {
      slot: 'head',
      wowheadId: '5150',
      donor: 'new'
    });
    assert.equal(out.slot, 'head');
    assert.equal(out.wowheadId, '5150');
    assert.equal(out.donor, 'new');
    assert.equal(out.name, 'Attrs', 'absent name key untouched');
    assert.equal(out.quantity, 4, 'quantity is not editable here');
    assert.equal(out.remaining, 4, 'remaining is not editable here');
    assert.equal(out.status, 'available', 'status is not editable here');
  });

  test('editItem: a null or blank value clears the column', async () => {
    const item = await addItem(GUILD, {
      name: 'Clearable',
      slot: 'head',
      wowheadId: '77',
      notes: 'keep me?'
    });
    const out = await editItem(GUILD, item.id, { slot: null, wowheadId: '  ', notes: '' });
    assert.equal(out.slot, null, 'null clears slot');
    assert.equal(out.wowheadId, null, 'blank string clears wowhead id');
    assert.equal(out.notes, null, 'empty string clears notes');
  });

  test('editItem: rejects a blank name and an empty patch', async () => {
    const item = await addItem(GUILD, { name: 'Named', quantity: 1 });
    await assert.rejects(
      () => editItem(GUILD, item.id, { name: '   ' }),
      (e) => e.code === 'INVALID_INPUT'
    );
    await assert.rejects(
      () => editItem(GUILD, item.id, {}),
      (e) => e.code === 'INVALID_INPUT'
    );
    assert.equal((await getItem(GUILD, item.id)).name, 'Named', 'a rejected edit changes nothing');
  });

  test('editItem: rejects a withdrawn item and a missing item', async () => {
    const item = await addItem(GUILD, { name: 'Pulled', quantity: 1 });
    await removeItem(GUILD, item.id, 'mgr');
    await assert.rejects(
      () => editItem(GUILD, item.id, { name: 'Nope' }),
      (e) => e.code === 'ITEM_WITHDRAWN'
    );
    await assert.rejects(
      () => editItem(GUILD, 'itm_nope', { name: 'Ghost' }),
      (e) => e.code === 'ITEM_NOT_FOUND'
    );
  });

  test('editItem: sets and replaces tags (text[]), leaving other columns untouched', async () => {
    const item = await addItem(GUILD, { name: 'Tagged', slot: 'hands', tags: ['old'] });
    const set = await editItem(GUILD, item.id, { tags: ['engineering', 'caster'] });
    assert.deepEqual(set.tags, ['engineering', 'caster'], 'present array replaces the tags');
    assert.equal(set.slot, 'hands', 'an absent key is left unchanged');
    assert.equal(set.name, 'Tagged', 'name untouched');
  });

  test('editItem: a non-array tags value clears to an empty array (never null)', async () => {
    const item = await addItem(GUILD, { name: 'Clearable', tags: ['drop', 'me'] });
    const cleared = await editItem(GUILD, item.id, { tags: null });
    assert.deepEqual(cleared.tags, [], 'null clears to [] under the not-null constraint');
  });

  test('editItem: an absent tags key leaves existing tags untouched', async () => {
    const item = await addItem(GUILD, { name: 'Keep', tags: ['stay'] });
    const out = await editItem(GUILD, item.id, { name: 'Keep2' });
    assert.deepEqual(out.tags, ['stay'], 'absent tags key is not applied');
    assert.equal(out.name, 'Keep2');
  });
}
