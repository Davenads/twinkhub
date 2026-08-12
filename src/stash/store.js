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
// 'withdrawn'.
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

    await client.query(
      `update stash_requests
         set status = 'cancelled', decided_by = $2, decided_at = now()
       where item_id = $1 and status in ('pending', 'approved')`,
      [itemId, managerId]
    );
    const upd = await client.query(
      `update stash_items set status = 'withdrawn' where id = $1 returning *`,
      [itemId]
    );
    await client.query('commit');
    return rowToItem(upd.rows[0]);
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
// count reverted and the affected item ids (for audit/logging).
export async function expireStaleApprovals(
  guildId,
  { staleApprovalDays = 5, now = new Date() } = {}
) {
  const cutoff = new Date(now.getTime() - staleApprovalDays * 24 * 60 * 60 * 1000);
  const client = await getPool().connect();
  try {
    await client.query('begin');
    const stale = await client.query(
      `select id, item_id from stash_requests
       where guild_id = $1 and status = 'approved' and decided_at < $2
       order by item_id, id
       for update`,
      [guildId, cutoff.toISOString()]
    );
    if (!stale.rows.length) {
      await client.query('commit');
      return { reverted: 0, itemIds: [] };
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

    await client.query('commit');
    return { reverted: ids.length, itemIds };
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
