import crypto from 'node:crypto';
import { createPool } from './db.js';

// Community Stash repository — the ONLY module that talks to Postgres. Commands
// and the panel call these functions and never import `pg` directly. The pool is
// created lazily on first use so a DB outage (or an unset DATABASE_URL) never
// blocks bot boot; callers guard with isEnabled() and degrade the stash feature
// alone.

let pool;

function getPool() {
  if (!pool) pool = createPool();
  return pool;
}

// True when the stash is configured. Handlers short-circuit with a friendly
// "stash isn't set up" message when this is false, leaving the rest of the bot
// untouched.
export function isEnabled() {
  return Boolean(process.env.DATABASE_URL);
}

// Close the pool (graceful shutdown / test teardown). Safe to call when never
// opened.
export async function shutdown() {
  if (pool) {
    await pool.end();
    pool = undefined;
  }
}

// Typed error so handlers translate a stable `code` into user-facing text without
// parsing raw Postgres SQLSTATEs.
export class StashError extends Error {
  constructor(code, message) {
    super(message ?? code);
    this.name = 'StashError';
    this.code = code;
  }
}

function newId(prefix) {
  return `${prefix}_${crypto.randomBytes(10).toString('hex')}`;
}

function rowToItem(r) {
  return {
    id: r.id,
    guildId: r.guild_id,
    name: r.name,
    wowheadId: r.wowhead_id,
    slot: r.slot,
    quantity: r.quantity,
    remaining: r.remaining,
    status: r.status,
    donor: r.donor,
    tags: r.tags,
    notes: r.notes,
    createdAt: r.created_at,
    updatedAt: r.updated_at
  };
}

function rowToRequest(r) {
  return {
    id: r.id,
    guildId: r.guild_id,
    itemId: r.item_id,
    userId: r.user_id,
    status: r.status,
    decidedBy: r.decided_by,
    decidedAt: r.decided_at,
    createdAt: r.created_at,
    updatedAt: r.updated_at
  };
}

// Single source of truth for item status. Must run with the item row already
// locked (FOR UPDATE) in the same transaction. Reserved = approved-but-not-sent
// claims on the remaining units; 'sent' requests already decremented remaining so
// they are deliberately NOT counted. Never overrides the terminal 'withdrawn'.
async function recomputeItemStatus(client, itemId) {
  const { rows } = await client.query(
    `select i.remaining, i.status,
            (select count(*) from stash_requests r
             where r.item_id = i.id and r.status = 'approved')::int as reserved
     from stash_items i
     where i.id = $1`,
    [itemId]
  );
  if (!rows.length) return;
  const { remaining, status, reserved } = rows[0];
  if (status === 'withdrawn') return;

  let next;
  if (remaining <= 0) next = 'given';
  else if (remaining - reserved <= 0) next = 'requested';
  else next = 'available';

  if (next !== status) {
    await client.query('update stash_items set status = $2 where id = $1', [itemId, next]);
  }
}

// Shared transaction for request-scoped mutations: locks the request row then its
// item row (consistent order request -> item, which is what keeps parallel
// approvals from oversalling), runs `mutate`, then recomputes the item status and
// commits. `mutate(client, request, item)` returns the method's result.
async function withRequestTxn(guildId, requestId, mutate) {
  const client = await getPool().connect();
  try {
    await client.query('begin');

    const reqRes = await client.query(
      `select * from stash_requests where id = $1 and guild_id = $2 for update`,
      [requestId, guildId]
    );
    if (!reqRes.rows.length) {
      throw new StashError('REQUEST_NOT_FOUND', 'request not found');
    }
    const request = reqRes.rows[0];

    const itemRes = await client.query(
      `select * from stash_items where id = $1 and guild_id = $2 for update`,
      [request.item_id, guildId]
    );
    if (!itemRes.rows.length) {
      throw new StashError('ITEM_NOT_FOUND', 'item not found');
    }
    const item = itemRes.rows[0];

    const result = await mutate(client, request, item);
    await recomputeItemStatus(client, item.id);
    await client.query('commit');
    return result;
  } catch (err) {
    await client.query('rollback').catch(() => {});
    throw err;
  } finally {
    client.release();
  }
}

// Add a donated item. remaining starts equal to quantity; status 'available'.
export async function addItem(
  guildId,
  { name, wowheadId = null, slot = null, quantity = 1, donor = null, tags = [], notes = null }
) {
  if (!name || !String(name).trim()) {
    throw new StashError('INVALID_INPUT', 'name is required');
  }
  const qty = Number(quantity);
  if (!Number.isInteger(qty) || qty < 1) {
    throw new StashError('INVALID_INPUT', 'quantity must be an integer >= 1');
  }

  const id = newId('itm');
  const { rows } = await getPool().query(
    `insert into stash_items
       (id, guild_id, name, wowhead_id, slot, quantity, remaining, donor, tags, notes)
     values ($1, $2, $3, $4, $5, $6, $6, $7, $8, $9)
     returning *`,
    [id, guildId, String(name).trim(), wowheadId, slot, qty, donor, tags, notes]
  );
  return rowToItem(rows[0]);
}

// Find active items a new add would merge into (dedup). Identity is tiered: an
// exact wowhead_id match (canonical, any name), else a normalized-name match
// (lower + trim). When the add carries a wowhead_id, a name match qualifies only
// when the candidate has no id yet (a null-id row we can backfill) — a row
// bearing a DIFFERENT id is a distinct same-name item and is excluded. Withdrawn
// rows are never matched (deliberately pulled). Ordered created_at asc so the
// caller restocks the earliest. Returns [] when neither key is usable.
export async function findItemMatch(guildId, { wowheadId = null, name = null } = {}) {
  const trimmedName = name != null && String(name).trim() ? String(name).trim() : null;
  if (!wowheadId && !trimmedName) return [];

  const params = [guildId];
  const ors = [];
  if (wowheadId) {
    params.push(wowheadId);
    ors.push(`wowhead_id = $${params.length}`);
  }
  if (trimmedName) {
    params.push(trimmedName);
    const p = params.length;
    ors.push(
      wowheadId
        ? `(wowhead_id is null and lower(btrim(name)) = lower(btrim($${p})))`
        : `lower(btrim(name)) = lower(btrim($${p}))`
    );
  }

  const { rows } = await getPool().query(
    `select * from stash_items
     where guild_id = $1
       and status in ('available', 'requested', 'given')
       and (${ors.join(' or ')})
     order by created_at asc`,
    params
  );
  return rows.map(rowToItem);
}

// Restock an existing item instead of inserting a duplicate: bump quantity AND
// remaining by addQty together (so the remaining_within_quantity check holds),
// and COALESCE-backfill wowhead_id/slot so a first-donation id is inherited and
// never re-typed. recomputeItemStatus reactivates a 'given' (exhausted) row.
// Refuses a withdrawn item; FOR UPDATE serialises against concurrent
// approvals/sends on the same row.
export async function restockItem(guildId, itemId, addQty, { wowheadId = null, slot = null } = {}) {
  const n = Number(addQty);
  if (!Number.isInteger(n) || n < 1) {
    throw new StashError('INVALID_INPUT', 'restock quantity must be an integer >= 1');
  }
  const client = await getPool().connect();
  try {
    await client.query('begin');
    const cur = await client.query(
      'select status from stash_items where id = $1 and guild_id = $2 for update',
      [itemId, guildId]
    );
    if (!cur.rows.length) {
      throw new StashError('ITEM_NOT_FOUND', 'item not found');
    }
    if (cur.rows[0].status === 'withdrawn') {
      throw new StashError('ITEM_WITHDRAWN', 'cannot restock a withdrawn item');
    }
    await client.query(
      `update stash_items
         set quantity = quantity + $2,
             remaining = remaining + $2,
             wowhead_id = coalesce(wowhead_id, $3),
             slot = coalesce(slot, $4)
       where id = $1`,
      [itemId, n, wowheadId, slot]
    );
    await recomputeItemStatus(client, itemId);
    const { rows } = await client.query('select * from stash_items where id = $1', [itemId]);
    await client.query('commit');
    return rowToItem(rows[0]);
  } catch (err) {
    await client.query('rollback').catch(() => {});
    throw err;
  } finally {
    client.release();
  }
}

// Editable attribute keys -> their column. Deliberately excludes
// quantity/remaining/status: those stay owned by restock/withdraw and the request
// lifecycle, since editing them here would risk the remaining_within_quantity and
// reserved-count invariants (a guarded quantity-correction path is a follow-up).
const EDITABLE_COLUMNS = {
  name: 'name',
  slot: 'slot',
  wowheadId: 'wowhead_id',
  donor: 'donor',
  notes: 'notes'
};

// Correct an existing item's ATTRIBUTES (name/slot/wowheadId/donor/notes) — e.g.
// a name typo. Partial patch: a key PRESENT is applied (null, or a blank string,
// CLEARS the column); an ABSENT key is left untouched. `name` is required if
// present (blank rejected). Refuses a withdrawn row; FOR UPDATE serialises against
// a concurrent restock/approve on the same row. Does NOT dedup — renaming into a
// name/id collision is allowed (consolidation owns merges), so the caller may
// findItemMatch afterwards to warn.
export async function editItem(guildId, itemId, patch = {}) {
  const params = [itemId, guildId];
  const sets = [];
  for (const [key, column] of Object.entries(EDITABLE_COLUMNS)) {
    if (!(key in patch)) continue;
    let value = patch[key];
    if (key === 'name') {
      if (value == null || !String(value).trim()) {
        throw new StashError('INVALID_INPUT', 'name cannot be blank');
      }
      value = String(value).trim();
    } else if (typeof value === 'string') {
      const trimmed = value.trim();
      value = trimmed === '' ? null : trimmed;
    }
    params.push(value);
    sets.push(`${column} = $${params.length}`);
  }
  if (!sets.length) {
    throw new StashError('INVALID_INPUT', 'no fields to update');
  }

  const client = await getPool().connect();
  try {
    await client.query('begin');
    const cur = await client.query(
      'select status from stash_items where id = $1 and guild_id = $2 for update',
      [itemId, guildId]
    );
    if (!cur.rows.length) {
      throw new StashError('ITEM_NOT_FOUND', 'item not found');
    }
    if (cur.rows[0].status === 'withdrawn') {
      throw new StashError('ITEM_WITHDRAWN', 'cannot edit a withdrawn item');
    }
    await client.query(
      `update stash_items set ${sets.join(', ')} where id = $1 and guild_id = $2`,
      params
    );
    const { rows } = await client.query('select * from stash_items where id = $1', [itemId]);
    await client.query('commit');
    return rowToItem(rows[0]);
  } catch (err) {
    await client.query('rollback').catch(() => {});
    throw err;
  } finally {
    client.release();
  }
}

// End-user "Request" action. Non-exclusive: it never touches remaining (only a
// later markSent does). Serialised per (guild,user) with an advisory xact lock so
// a single user's rapid double-clicks can't slip past the per-user cap. Returns
// the existing open request on a re-click (idempotent).
export async function requestItem(guildId, itemId, userId, { requestCap = 3 } = {}) {
  const client = await getPool().connect();
  try {
    await client.query('begin');
    await client.query('select pg_advisory_xact_lock(hashtext($1))', [`${guildId}:${userId}`]);

    const existing = await client.query(
      `select * from stash_requests
       where guild_id = $1 and item_id = $2 and user_id = $3
         and status in ('pending', 'approved')
       limit 1`,
      [guildId, itemId, userId]
    );
    if (existing.rows.length) {
      await client.query('commit');
      return rowToRequest(existing.rows[0]);
    }

    const itemRes = await client.query(
      `select * from stash_items where id = $1 and guild_id = $2`,
      [itemId, guildId]
    );
    if (!itemRes.rows.length) {
      throw new StashError('ITEM_NOT_FOUND', 'item not found');
    }
    const item = itemRes.rows[0];
    if (item.status !== 'available' || item.remaining < 1) {
      throw new StashError('ITEM_NOT_AVAILABLE', 'item is not available');
    }

    const openCount = await client.query(
      `select count(*)::int as n from stash_requests
       where guild_id = $1 and user_id = $2 and status in ('pending', 'approved')`,
      [guildId, userId]
    );
    if (openCount.rows[0].n >= requestCap) {
      throw new StashError('CAP_REACHED', `request cap of ${requestCap} reached`);
    }

    const ins = await client.query(
      `insert into stash_requests (id, guild_id, item_id, user_id)
       values ($1, $2, $3, $4)
       returning *`,
      [newId('req'), guildId, itemId, userId]
    );
    await client.query('commit');
    return rowToRequest(ins.rows[0]);
  } catch (err) {
    await client.query('rollback').catch(() => {});
    throw err;
  } finally {
    client.release();
  }
}

// Manager approval — the exclusive step that must never oversell. Under the item
// lock, reserved = approved-but-not-sent claims; approval is allowed only while
// remaining - reserved >= 1. recomputeItemStatus then flips the item to
// 'requested' once every remaining unit is spoken for.
export async function approveRequest(guildId, requestId, managerId) {
  return withRequestTxn(guildId, requestId, async (client, request, item) => {
    if (request.status !== 'pending') {
      throw new StashError('REQUEST_NOT_PENDING', `request is ${request.status}`);
    }

    const outRes = await client.query(
      `select count(*)::int as n from stash_requests
       where item_id = $1 and status = 'approved'`,
      [item.id]
    );
    if (item.remaining - outRes.rows[0].n < 1) {
      throw new StashError('NO_STOCK', 'no stock left to approve');
    }

    const upd = await client.query(
      `update stash_requests
         set status = 'approved', decided_by = $2, decided_at = now()
       where id = $1
       returning *`,
      [requestId, managerId]
    );
    return rowToRequest(upd.rows[0]);
  });
}

// Manager marks an approved request as physically handed out. Decrements the
// item's remaining; recomputeItemStatus flips the item to 'given' at zero.
export async function markSent(guildId, requestId, managerId) {
  return withRequestTxn(guildId, requestId, async (client, request, item) => {
    if (request.status !== 'approved') {
      throw new StashError('REQUEST_NOT_APPROVED', `request is ${request.status}`);
    }
    if (item.remaining < 1) {
      throw new StashError('NO_STOCK', 'no remaining stock to send');
    }
    await client.query('update stash_items set remaining = remaining - 1 where id = $1', [item.id]);
    const upd = await client.query(
      `update stash_requests
         set status = 'sent', decided_by = $2, decided_at = now()
       where id = $1
       returning *`,
      [requestId, managerId]
    );
    return rowToRequest(upd.rows[0]);
  });
}

// Manager denies an open (pending or approved) request. Freeing an approved
// request returns its reserved unit to the pool via recomputeItemStatus.
export async function denyRequest(guildId, requestId, managerId) {
  return withRequestTxn(guildId, requestId, async (client, request) => {
    if (!['pending', 'approved'].includes(request.status)) {
      throw new StashError('REQUEST_NOT_OPEN', `request is ${request.status}`);
    }
    const upd = await client.query(
      `update stash_requests
         set status = 'denied', decided_by = $2, decided_at = now()
       where id = $1
       returning *`,
      [requestId, managerId]
    );
    return rowToRequest(upd.rows[0]);
  });
}

// Requester cancels their own open request. Ownership-gated; frees a reserved
// unit when cancelling an approved request.
export async function cancelRequest(guildId, requestId, userId) {
  return withRequestTxn(guildId, requestId, async (client, request) => {
    if (request.user_id !== userId) {
      throw new StashError('NOT_OWNER', 'only the requester can cancel');
    }
    if (!['pending', 'approved'].includes(request.status)) {
      throw new StashError('REQUEST_NOT_OPEN', `request is ${request.status}`);
    }
    const upd = await client.query(
      `update stash_requests set status = 'cancelled' where id = $1 returning *`,
      [requestId]
    );
    return rowToRequest(upd.rows[0]);
  });
}

// Manager withdraws an item from the stash. Cascade-cancels its open (pending or
// approved) requests; sent history is preserved. Item goes to terminal
// 'withdrawn'. Returns { item, cancelled } where cancelled is the list of
// affected requests ({ id, userId, itemId }) so the caller can DM each requester.
export async function removeItem(guildId, itemId, managerId) {
  const client = await getPool().connect();
  try {
    await client.query('begin');
    const itemRes = await client.query(
      `select * from stash_items where id = $1 and guild_id = $2 for update`,
      [itemId, guildId]
    );
    if (!itemRes.rows.length) {
      throw new StashError('ITEM_NOT_FOUND', 'item not found');
    }

    const cancelledRes = await client.query(
      `update stash_requests
         set status = 'cancelled', decided_by = $2, decided_at = now()
       where item_id = $1 and status in ('pending', 'approved')
       returning id, user_id, item_id`,
      [itemId, managerId]
    );
    const upd = await client.query(
      `update stash_items set status = 'withdrawn' where id = $1 returning *`,
      [itemId]
    );
    await client.query('commit');
    const cancelled = cancelledRes.rows.map((r) => ({
      id: r.id,
      userId: r.user_id,
      itemId: r.item_id
    }));
    return { item: rowToItem(upd.rows[0]), cancelled };
  } catch (err) {
    await client.query('rollback').catch(() => {});
    throw err;
  } finally {
    client.release();
  }
}

// Sweep stale approvals (a Manager approved but never sent within N days) back to
// 'pending' so the reserved unit frees up and the queue keeps moving. Per-guild;
// called from the 60s tick with the guild's stash.staleApprovalDays. Returns the
// count reverted, the affected item ids (for audit/logging), and the reverted
// requests ({ id, userId, itemId }) so the tick can DM each requester.
export async function expireStaleApprovals(
  guildId,
  { staleApprovalDays = 5, now = new Date() } = {}
) {
  const cutoff = new Date(now.getTime() - staleApprovalDays * 24 * 60 * 60 * 1000);
  const client = await getPool().connect();
  try {
    await client.query('begin');
    const stale = await client.query(
      `select id, item_id, user_id from stash_requests
       where guild_id = $1 and status = 'approved' and decided_at < $2
       order by item_id, id
       for update`,
      [guildId, cutoff.toISOString()]
    );
    if (!stale.rows.length) {
      await client.query('commit');
      return { reverted: 0, itemIds: [], requests: [] };
    }

    const ids = stale.rows.map((r) => r.id);
    await client.query(
      `update stash_requests
         set status = 'pending', decided_by = null, decided_at = null
       where id = any($1::text[])`,
      [ids]
    );

    const itemIds = [...new Set(stale.rows.map((r) => r.item_id))];
    for (const itemId of itemIds) {
      await client.query('select 1 from stash_items where id = $1 for update', [itemId]);
      await recomputeItemStatus(client, itemId);
    }

    const requests = stale.rows.map((r) => ({
      id: r.id,
      userId: r.user_id,
      itemId: r.item_id
    }));
    await client.query('commit');
    return { reverted: ids.length, itemIds, requests };
  } catch (err) {
    await client.query('rollback').catch(() => {});
    throw err;
  } finally {
    client.release();
  }
}

// Read: item detail. Returns null when not found in this guild.
export async function getItem(guildId, itemId) {
  const { rows } = await getPool().query(
    'select * from stash_items where id = $1 and guild_id = $2',
    [itemId, guildId]
  );
  return rows.length ? rowToItem(rows[0]) : null;
}

// Read: a single request by id (guild-scoped). Null when not found. Used by the
// manager console to re-read authoritative state before rendering an action.
export async function getRequest(guildId, requestId) {
  const { rows } = await getPool().query(
    'select * from stash_requests where id = $1 and guild_id = $2',
    [requestId, guildId]
  );
  return rows.length ? rowToRequest(rows[0]) : null;
}

// Read: items for the panel / list command. Defaults to the active statuses.
export async function listItems(
  guildId,
  { statuses = ['available', 'requested'], limit = 100 } = {}
) {
  const { rows } = await getPool().query(
    `select * from stash_items
     where guild_id = $1 and status = any($2::text[])
     order by created_at asc
     limit $3`,
    [guildId, statuses, limit]
  );
  return rows.map(rowToItem);
}

// Read: requests for the approval queue (statuses:['pending']) or a user's own
// list (userId). All filters are optional and AND together.
export async function listRequests(
  guildId,
  { itemId = null, userId = null, statuses = null } = {}
) {
  const clauses = ['guild_id = $1'];
  const params = [guildId];
  if (itemId) {
    params.push(itemId);
    clauses.push(`item_id = $${params.length}`);
  }
  if (userId) {
    params.push(userId);
    clauses.push(`user_id = $${params.length}`);
  }
  if (statuses) {
    params.push(statuses);
    clauses.push(`status = any($${params.length}::text[])`);
  }
  const { rows } = await getPool().query(
    `select * from stash_requests where ${clauses.join(' and ')} order by created_at asc`,
    params
  );
  return rows.map(rowToRequest);
}
