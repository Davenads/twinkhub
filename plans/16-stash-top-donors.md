# Plan 16 — Community Stash: Top Donors on the public panel

**Status: design locked, awaiting greenlight to implement. Two minor confirmations
below (donor-edit propagation, metric units). Nothing implemented yet.**

Goal: surface a lifetime "Top Donors" leaderboard on the public `#stash` panel so
the community can see who keeps the stash full.

---

## Decisions (locked by the user 2026-08-15)

1. **Metric = lifetime total donations, permanent — counts stay even if the item
   is later withdrawn/given/consolidated.** This deliberately CANNOT be a live
   aggregate over `stash_items` (those rows mutate and drop out of the active
   view). ⇒ build an **append-only donations ledger table** (`stash_donations`)
   and aggregate off it. Confirmed: **no items have been withdrawn yet**, so the
   ledger can be **backfilled** from current `stash_items` state with full
   accuracy at cutover.
2. **Placement: its own embed** (a second embed on the panel message), not a field.
3. **Count: top 5.**
4. **Toggle default: on** (per-guild `stash.showTopDonors`, so a guild can still
   disable it — donor names are currently manager-only, so this is a new public
   exposure).

---

## Why a ledger (the permanence requirement)

The panel only ever loads active items (`available`/`requested`) at all three
build sites (`renderStashPanel` store.js:326, Refresh button components/stash.js:185,
tick timers/stash.js:107). A `given` or `withdrawn` donation is gone from that
view, so a live `sum(quantity)` over `stash_items` would erase a donor the moment
their gear went out or was pulled. The requirement is the opposite: a donation is
a permanent historical fact. An append-only ledger records each donation event
once, and nothing downstream (give-away, withdraw, consolidate, edit) ever
rewrites it. This also **fixes two attribution bugs** the live approach carried:

- **Restock miscredit:** `restockItem` never records the topping-up donor today
  (store.js:231), so a second donor's merged add was credited to the original
  lister. The ledger logs each top-up against its actual donor.
- **Consolidation double-count:** folding a dupe into a survivor no longer risks
  double counting, because the ledger already recorded each original add/restock
  and consolidation writes **nothing** new.

---

## Ledger schema (new migration)

`supabase/migrations/<ts>_create_stash_donations.sql`:

```sql
create table if not exists stash_donations (
  id          text primary key,
  guild_id    text not null,
  donor       text not null,                       -- free-text donor at donation time (denormalized)
  donor_key   text generated always as (lower(btrim(donor))) stored,  -- grouping key
  units       integer not null check (units > 0),  -- quantity donated in this event
  item_id     text references stash_items (id) on delete set null,     -- audit link; ledger survives item removal
  kind        text not null default 'add'
                check (kind in ('add', 'restock', 'backfill')),
  created_at  timestamptz not null default now()
);
create index if not exists stash_donations_guild_donor_idx
  on stash_donations (guild_id, donor_key);
create index if not exists stash_donations_guild_created_idx
  on stash_donations (guild_id, created_at);  -- future windowed leaderboards
```

Notes:
- `donor_key` is a **stored generated column** (`lower(btrim(donor))`) so grouping
  is consistent and the app never has to compute it. Only non-blank donors ever
  produce a row (write path guards), so `donor_key` is never empty.
- `on delete set null` (not cascade) honors "permanent": the ledger row outlives
  its item. In prod items are never hard-deleted (soft `withdrawn`), so this never
  fires there; in tests we clean the ledger explicitly (below).

### Backfill (same migration, runs once via `db push`)

Because nothing is withdrawn yet, current `stash_items` is a faithful snapshot of
all donations. Seed one ledger row per item that has a donor:

```sql
insert into stash_donations (id, guild_id, donor, units, item_id, kind, created_at)
select 'don_' || replace(gen_random_uuid()::text, '-', ''),
       guild_id, donor, quantity, id, 'backfill', created_at
from stash_items
where donor is not null and btrim(donor) <> '';
```

Caveat (documented, unavoidable): backfill credits each item's **current stored
donor** with its **current total quantity**. We can't reconstruct per-restock
donors that predate the ledger (that data was never captured). From cutover
forward, per-donation attribution is exact.

Harness note: the integration test harness runs all migrations only on a DB
missing `stash_items` (all-or-nothing guard). A fresh CI Postgres runs the new
migration (creates the table; backfill inserts nothing on an empty stash). A dev
Supabase that already has `stash_items` needs a real `db push` to get the new
table before `npm run test:int` — same operational model as today.

---

## Write path (store.js — the only SQL seam)

Add a small internal helper `logDonation(client, { guildId, donor, units, itemId,
kind })` that inserts a ledger row **only when `donor` is present and non-blank**,
and runs on the **same client/transaction** as the item mutation (never a separate
connection) so an item and its donation commit or roll back together.

- **`addItem`** — currently a bare pooled `insert`. Wrap it in `begin/commit` on
  one client and, after the item insert, `logDonation({ donor, units: quantity,
  itemId: id, kind: 'add' })`.
- **`restockItem`** — already transactional. Thread a `donor` through its options
  (`restockItem(guild, id, addQty, { wowheadId, slot, donor })`) and, inside the
  txn, `logDonation({ donor, units: addQty, itemId, kind: 'restock' })`. The item's
  own `donor` column stays first-donor as-is; the ledger captures every
  contributor. Update the caller: the `/stashadmin add` dedup branch
  (stashadmin.js ~630) passes the add's `donor` into the restock.
- **`consolidateItems`, `removeItem`/withdraw, `markSent`, `editItem`** — no ledger
  writes. They reorganize or spend existing units; the donation was already
  recorded. (See the donor-edit confirmation below.)

New aggregation query, off the ledger:

```sql
-- topDonors(guildId, { limit = 5 })
select max(donor) as donor, sum(units)::int as units
from stash_donations
where guild_id = $1
group by donor_key
order by units desc, donor_key asc   -- deterministic tie-break
limit $2;
```

Returns `[{ donor, units }]`. No status filter (ledger is permanent); nulls never
entered.

---

## Rendering (services/stash.js) — its own embed

`buildStashPanel` gains a `topDonors = []` arg and returns a **second embed** when
it is non-empty:

```
Top Donors
1. Dave — 12
2. Sara — 9
3. Bob — 7
4. Kim — 4
5. Lee — 2
```

- Embeds array becomes `[communityStashEmbed, topDonorsEmbed]` (Discord allows up
  to 10). Order: stash first, donors second.
- Omit the second embed entirely when there are no donors (no empty header).
- Numbered top-5 list; no emojis/medal glyphs unless later requested. Value stays
  well within the 4096 description cap; truncate defensively.
- Pure-function unit tests: renders N rows in order, omitted when empty, second
  embed present only when data + within caps.

---

## Wiring + config

- **Three build sites** load `topDonors` alongside `items` (gated on
  `stash.showTopDonors`, default true) and pass it through: `renderStashPanel`
  (store.js:326 — used by `/stashadmin panel` post/refresh), the Refresh button
  (components/stash.js:185), and the tick (timers/stash.js:107).
- **Fingerprint:** `stashFingerprint` hashes `id:status:remaining` only, so a bare
  donor change wouldn't refresh. Fold a cheap leaderboard hash (ordered
  `donorKey:units`) into the fingerprint so the tick re-renders when the
  leaderboard moves. One line.
- **Config:** add `showTopDonors` (bool) + `topDonorsCount` (int, default 5, clamp
  1–10) to the `stash` block via `setStash`, and surface them in
  `/stashadmin config set` + `show`. Adding options to the `set` subcommand is a
  **command-definition change ⇒ `npm run deploy`** (the only redeploy in this
  plan). Everything else is reload-only.

---

## Tests

- **Integration (`test/integration/stash-store.test.js`, self-skips without
  `DATABASE_URL`):** addItem logs one ledger row (and none when donor blank);
  restockItem logs against the topping-up donor; consolidate/withdraw/markSent add
  no rows and leave counts intact (permanence); `topDonors` sums per normalized
  donor, folds case/whitespace, orders + limits with a deterministic tie-break.
  Add `delete from stash_donations where guild_id = $1` to the harness
  `beforeEach`/`after` cleanup.
- **Unit (`test/services/stash.test.js`):** `buildStashPanel` second-embed render
  (present/omitted/order/caps).

## Slices (each behind the gate: `npm test` + lint + format:check)

1. Migration: create `stash_donations` + backfill. (Applied via `db push` as a
   deliberate step — never at boot.)
2. Store: `logDonation` helper, wire into `addItem` (now transactional) +
   `restockItem` (donor threaded), add `topDonors`. Integration tests.
3. Service: `buildStashPanel` second embed. Unit tests.
4. Wiring: 3 build sites + fingerprint + `/stashadmin config` toggle/count.
5. Gate → commit → push → `db push` (migration) → `npm run deploy` (config option
   added) → `pm2 reload twinkhub`.

---

## Residual micro-decisions (my recommendation in bold)

- **Metric unit = total units donated** (`sum(units)`, i.e. summed quantities),
  **not** number-of-donation-events. Matches "who gave the most stuff."
- **Editing an item's donor does NOT retro-adjust the ledger** for v1. The ledger
  records donor-as-recorded-at-donation-time; an item's units can come from
  several donors via restock, so an item-level donor edit has no single ledger row
  to correct. A dedicated donor-correction path is a deferred follow-up. (If you'd
  rather a donor edit rewrite that item's `add` ledger row, say so — it's a small
  addition but narrows to add-only donations.)

## Deferred follow-ups

- Donor-correction command that also amends ledger rows.
- Rolling-window leaderboard ("this month" — the `created_at` index is already
  planned for it).
- Realized give-away metric (units that reached a twink), via a requests join.
- Anonymity convention / per-donor opt-out.
- Medal-glyph or richer styling.
