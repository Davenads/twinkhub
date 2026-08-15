-- Community Stash: append-only donations ledger.
--
-- The Top Donors leaderboard needs LIFETIME totals that survive give-away,
-- withdrawal, and consolidation. A live aggregate over stash_items can't do that
-- (rows mutate and drop out of the active view), so every donation event is
-- recorded once here and never rewritten. Aggregation groups on donor_key.
--
-- Written by src/stash/store.js inside the same transaction as the item mutation
-- (addItem -> kind 'add', restockItem -> kind 'restock'), so an item and its
-- donation commit or roll back together. Only attributable (non-blank) donors get
-- a row. consolidate/withdraw/send/edit deliberately write nothing here.

create table if not exists stash_donations (
  id          text primary key,
  guild_id    text not null,
  -- Free-text donor as recorded at donation time (denormalized: a later item edit
  -- or withdrawal must not rewrite history).
  donor       text not null,
  -- Case/whitespace-insensitive grouping key, kept in lockstep with donor.
  donor_key   text generated always as (lower(btrim(donor))) stored,
  units       integer not null check (units > 0),
  -- Audit link back to the originating item. set null (not cascade) so the ledger
  -- outlives the item; prod never hard-deletes items (soft 'withdrawn'), so this
  -- never fires there.
  item_id     text references stash_items (id) on delete set null,
  kind        text not null default 'add'
                check (kind in ('add', 'restock', 'backfill')),
  created_at  timestamptz not null default now()
);

create index if not exists stash_donations_guild_donor_idx
  on stash_donations (guild_id, donor_key);

-- For future windowed ("this month") leaderboards.
create index if not exists stash_donations_guild_created_idx
  on stash_donations (guild_id, created_at);

-- Backfill from current stash_items. Safe because no item has been withdrawn yet,
-- so the current rows are a faithful snapshot of all donations. Credits each
-- item's stored donor with its current total quantity (per-restock donors that
-- predate this ledger were never captured; exact attribution begins at cutover).
insert into stash_donations (id, guild_id, donor, units, item_id, kind, created_at)
select 'don_' || replace(gen_random_uuid()::text, '-', ''),
       guild_id, donor, quantity, id, 'backfill', created_at
from stash_items
where donor is not null and btrim(donor) <> '';
