-- Community Stash: donated-item giveaway tables.
--
-- Two tables, both per-guild (guild_id column, no cross-guild queries):
--   stash_items    - the donated goods and their remaining count
--   stash_requests - end-user "Request" rows that Managers approve/send
--
-- Atomicity model (enforced in src/stash/store.js, not here): a Request is a
-- non-exclusive insert; the exclusive step is a Manager approval that takes
-- SELECT ... FOR UPDATE on the item row and checks
--   remaining - <outstanding approvals> > 0
-- before flipping a request to 'approved'. 'sent' decrements remaining; the item
-- moves to 'given' at 0. Per-user request caps use pg_advisory_xact_lock in the
-- app layer, so no schema-level function is needed for that.

-- Auto-maintain updated_at on any row change.
create or replace function set_updated_at() returns trigger as $$
begin
  new.updated_at = now();
  return new;
end;
$$ language plpgsql;

create table if not exists stash_items (
  id          text primary key,
  guild_id    text not null,
  name        text not null,
  wowhead_id  text,
  slot        text,
  quantity    integer not null default 1 check (quantity > 0),
  remaining   integer not null check (remaining >= 0),
  status      text not null default 'available'
                check (status in ('available', 'requested', 'given', 'withdrawn')),
  donor       text,
  tags        text[] not null default '{}',
  notes       text,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  constraint remaining_within_quantity check (remaining <= quantity)
);

create index if not exists stash_items_guild_status_idx
  on stash_items (guild_id, status);

create trigger stash_items_set_updated_at
  before update on stash_items
  for each row execute function set_updated_at();

create table if not exists stash_requests (
  id          text primary key,
  guild_id    text not null,
  item_id     text not null references stash_items (id) on delete cascade,
  user_id     text not null,
  status      text not null default 'pending'
                check (status in ('pending', 'approved', 'sent', 'denied', 'cancelled')),
  decided_by  text,
  decided_at  timestamptz,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

-- Approval accounting counts outstanding rows per item and status.
create index if not exists stash_requests_item_status_idx
  on stash_requests (item_id, status);

-- Per-user request-cap lookups and "my requests" views.
create index if not exists stash_requests_guild_user_idx
  on stash_requests (guild_id, user_id);

create trigger stash_requests_set_updated_at
  before update on stash_requests
  for each row execute function set_updated_at();
