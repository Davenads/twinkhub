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

// Manager approval — the exclusive step that must never oversell. Locks the
// request row then the item row (consistent order: request -> item) and rechecks
// remaining minus outstanding approvals/sends under the item lock, so parallel
// approvals across pooled connections serialise instead of racing.
export async function approveRequest(guildId, requestId, managerId) {
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
    if (request.status !== 'pending') {
      throw new StashError('REQUEST_NOT_PENDING', `request is ${request.status}`);
    }

    const itemRes = await client.query(
      `select * from stash_items where id = $1 and guild_id = $2 for update`,
      [request.item_id, guildId]
    );
    if (!itemRes.rows.length) {
      throw new StashError('ITEM_NOT_FOUND', 'item not found');
    }
    const item = itemRes.rows[0];

    const outRes = await client.query(
      `select count(*)::int as n from stash_requests
       where item_id = $1 and status in ('approved', 'sent')`,
      [item.id]
    );
    const outstanding = outRes.rows[0].n;
    if (item.remaining - outstanding < 1) {
      throw new StashError('NO_STOCK', 'no stock left to approve');
    }

    const upd = await client.query(
      `update stash_requests
         set status = 'approved', decided_by = $2, decided_at = now()
       where id = $1
       returning *`,
      [requestId, managerId]
    );

    // Once every remaining unit is spoken for, reflect that on the item so the
    // panel stops offering it.
    if (item.remaining - (outstanding + 1) < 1 && item.status === 'available') {
      await client.query(`update stash_items set status = 'requested' where id = $1`, [item.id]);
    }

    await client.query('commit');
    return rowToRequest(upd.rows[0]);
  } catch (err) {
    await client.query('rollback').catch(() => {});
    throw err;
  } finally {
    client.release();
  }
}
