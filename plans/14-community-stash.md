# 14 — Community Stash (donated-item giveaway system)

A system for cataloguing twink items the guild has on hand and **giving them away
fairly** to guildies (new and established). Inspired by a player who donated a large
batch of twink gear; we want a proper intake → browse → request → approve → hand-off
pipeline instead of ad-hoc "who wants this?" spam. Two front-ends, mirroring the rest
of TwinkHub: **slash commands** and a **persistent panel channel**.

**Status: shipped (2026-08-12).** The planning content below is retained as the design
record; see **[As built](#as-built-shipped-2026-08-12)** at the end for the shipped
command surface, store API, config keys, and where the implementation diverged from this
plan.

---

## Decisions locked

- **Backend: Postgres on Supabase.** The existing paid ($20/mo) Supabase account.
  Reached by `DATABASE_URL`, behind the `src/stash/store.js` repository. **Connect via
  the Supabase CLI** (link the project, manage schema/migrations through it). One
  backend everywhere — local pm2 and production both point at Supabase (a dedicated dev
  schema/branch for local; see Storage & durability).
- **Request model, not self-serve.** Users **request** items; a **Manager** approves,
  then separately marks them **sent** (two distinct actions). Nothing is auto-reserved
  by a click.
- **Two roles:**
  - **Twink role** — gates **requesting** only. Anyone can *browse*; only Twink-role
    members can request.
  - **Manager role** — approves / denies / sends / manages inventory.
- **Quantities:** support stacks (`quantity > 1`); approvals draw the stack down.
- **Request cap:** 3 simultaneous open requests per user. No per-user cooldown.
- **No new-member priority.** Managers decide fairness by hand.
- **Donors: anonymous.** No public attribution, no "top donors" board; donors are
  announced manually for now. (An optional Manager-only donor note is kept for records.)
- **Stale approvals expire after 5 days** — an `approved`-but-never-`sent` request
  reverts to the queue automatically.
- **Terminology:** the user-facing verb is **Request** (record type = `request`, table
  `stash_requests`). "Claim" is retired to avoid the WoW loot-claim connotation.

### Build decisions (from the code review)

- **Driver + connection:** `pg` (node-postgres), small pool (`max: 5`), against
  Supabase's **Session pooler (IPv4, port 5432)** with `sslmode=require` — the direct
  host is IPv6-only; session pooling suits a single long-lived process and keeps
  prepared statements.
- **Failure isolation:** the pool connects **lazily** and `DATABASE_URL` is **optional**
  (read outside `env.js`'s fail-fast). Absent/unreachable → the stash disables
  gracefully; timers, panels, and reference commands keep running.
- **Tests:** `npm test` stays unit-only and secretless; a new `npm run test:int` runs
  SQL/concurrency tests against an ephemeral Postgres (CI `services:` container / a local
  dev project). Integration tests **skip** when `DATABASE_URL` is unset, so the default
  run stays green in a secretless CI.
- **Local + migrations:** a **separate free Supabase dev project** for local/tests (the
  paid prod project stays clean); schema via **Supabase CLI migrations**
  (`supabase/migrations/`, applied with `db push` as a deliberate deploy step — never by
  the bot at boot).
- **Command shape:** split **`/stash`** (enduser, public) + **`/stashadmin`** (Manager,
  `setDefaultMemberPermissions(ManageGuild)` to hide it from non-managers), with the
  config-based runtime gates layered on top.
- **Panel refresh:** reuse `board.js`'s edit/repost on the existing **60s tick**; the
  public message is a compact category/counts board, the full list is always ephemeral.
- **Request-cap enforcement:** a **per-user advisory lock**
  (`pg_advisory_xact_lock(hash(guildId+userId))`) inside the insert transaction — exact,
  no schema change, per-user contention only.
- **Requester gate:** `requireRequester` passes on **Twink role OR Manager OR Manage
  Server** (managers are guildies too, and can self-add/approve anyway).
- **`bulk` intake:** one row per line (no auto-merge of duplicate names), with a
  confirm-count step (`about to add N items`) as the double-paste guard.

---

## Name

Recommendation: **Community Stash** as the human-facing name, `stash` as the code
identifier (module, customId namespace, config key, storage namespace).

| Candidate | Read |
| --- | --- |
| **Community Stash** (pick) | clear, communal, no in-game collision, short slug `stash` |
| Twink Stash | fine, slightly redundant (whole bot is twink) |
| Guild Bank | avoid — collides with WoW's actual in-game guild bank feature/term |

Surface naming: feature = **Community Stash**, channel = `#stash`, the admin persona =
**Manager** (matches the configured Manager role).

---

## What makes this different (read first)

Every existing data surface (`/bis`, panels, timer board) reads **authored,
read-only** content that is validated once and cached at boot (`content/store.js`).
The stash is the opposite:

- **Mutable** — items are added, requested, approved, handed off, and removed
  constantly.
- **Transactional** — approving a request must be atomic; a single unit cannot be
  approved to two people. (Note: because requests are non-exclusive, the click-race
  moves off the enduser entirely — many users may request the same item, but only one
  **approval** per unit can succeed. Atomicity lives at the Manager's approve step, not
  the public button.)
- **Durable + irreplaceable** — losing the stash loses real inventory and the record
  of who-requested / who-received-what. Unlike latches it does not regenerate, and
  unlike the content store it is not reproducible from git.

Consequences that shape the whole design:

1. It **cannot** live in `data/content/` or the content store. It is state, not
   authored knowledge.
2. It **must** go through a durable, transactional store — Postgres (Supabase), behind
   the P2 #4 repository seam (see Storage & durability).
3. Its panels **write state from a public button** (the Request button) — which the
   enduser-panels spec (`08`) forbids for content panels. This is a deliberate, guarded
   extension of the panel model (see Panel system). The write is a low-stakes,
   reversible, non-exclusive *request insert*, never an allocation.

---

## Data model

Per-guild. Two record types kept separate so requests have their own audit trail and
the Manager queue is natural.

### `item`

```json
{
  "id": "itm_a1b2c3",
  "name": "Green Tinted Goggles",
  "wowheadId": null,
  "slot": "head",
  "quantity": 1,
  "remaining": 1,
  "status": "available",
  "donor": { "userId": "…", "display": "Gh^" },
  "addedBy": "…",
  "addedAt": 0,
  "tags": ["engineering", "caster"],
  "notes": "BoE, mailed to the bank alt"
}
```

- `id` — opaque, generated (`itm_` + short random). Never a WoW id (items repeat).
- `quantity` — total units (usually 1; >1 for stacked consumables/mats). `remaining` —
  units not yet `given`, decremented on each `sent`.
- `status` ∈ `available | requested | given | withdrawn`. `available` = units remain
  and none are actively approved; `requested` = has at least one open request/approval
  but units remain (still selectable — the Manager decides); `given` = `remaining` hit
  0 (closed); `withdrawn` = pulled by a Manager. A stack stays visible until the last
  unit is `given`.
- `donor` — optional, **Manager-only** record. Never surfaced publicly (donors are
  announced manually). No leaderboard.
- `slot` / `tags` — drive browse filters. `slot` can reuse the content store's slot
  vocabulary; `tags` are free slugs.

(No `flagged` field — with request-and-approve, *every* item is Manager-approved, so a
per-item "needs approval" flag is redundant.)

### `request`

```json
{
  "id": "req_x9y8z7",
  "itemId": "itm_a1b2c3",
  "userId": "…",
  "status": "pending",
  "createdAt": 0,
  "decidedBy": null,
  "decidedAt": null,
  "note": null
}
```

- `status` ∈ `pending | approved | sent | denied | cancelled`.
  - `pending` — sitting in the Manager queue.
  - `approved` — Manager picked this requester; in-game hand-off pending. Reserves one
    unit. **Auto-expires back to the queue after 5 days if never `sent`.**
  - `sent` — Manager confirmed the item was mailed/traded; `remaining` decrements
    (item → `given` when it reaches 0).
  - `denied` — Manager rejected it.
  - `cancelled` — the requester withdrew before a decision.
- One **active** (`pending`/`approved`) request per (item, user). Idempotent: a
  double-click does not create a second request.
- **Quantity draw-down:** each `approved` reserves one of `remaining`; each `sent`
  decrements it. Approvals are allowed while `remaining` (minus outstanding approvals)
  > 0. When the last unit is spoken for, further approvals fail ("no units left");
  still-`pending` siblings can be denied by the Manager or left until units free up
  (e.g. an approval expires).

### Storage shape

Postgres, relational (see below). No JSON blob; each item / request is a row.

---

## Storage & durability

Backend is **Postgres on Supabase**, reached by `DATABASE_URL`, behind a narrow
repository so call sites (commands, panel handlers) never touch SQL — the P2 #4 seam
pattern:

```
src/stash/store.js  (the repository — the ONLY module that touches persistence)
  listItems(guildId, { status?, slot?, tag? })
  addItem(guildId, item)
  requestItem(guildId, itemId, userId)          // insert a pending request (non-exclusive)
  listRequests(guildId, { status? })            // Manager queue
  approveRequest(guildId, requestId, managerId)  // atomic; reserves a unit
  denyRequest(guildId, requestId, managerId)
  markSent(guildId, requestId, managerId)        // request → sent, remaining--
  cancelRequest(guildId, requestId, userId)
  removeItem(guildId, itemId, managerId)
  expireStaleApprovals(guildId)                  // approved > 5d -> back to pending
```

**Schema:**

```sql
stash_items    (id PK, guild_id, name, wowhead_id, slot, quantity, remaining, status,
                donor_user_id, donor_display, added_by, added_at, tags jsonb, notes)
stash_requests (id PK, guild_id, item_id FK, user_id, status, created_at,
                decided_by, decided_at, note)
-- indexes: stash_items(guild_id, status); stash_requests(guild_id, status),
--          stash_requests(item_id);  partial unique on one active request per (item,user)

-- requestItem: plain insert, no exclusivity, no lock contention.
-- approveRequest is the atomic step:
--   BEGIN;
--     SELECT … FOR UPDATE the item row;               -- serialize approvals per item
--     if (remaining - outstanding_approvals) > 0:
--         UPDATE this request -> approved;             -- reserves a unit
--     else: fail "no units left";
--   COMMIT;                                            -- row lock guarantees no oversell
-- markSent: request -> sent; UPDATE remaining = remaining - 1;
--           if remaining = 0 -> status = 'given'.
```

**Provider — Supabase (decided).** Use the existing paid Supabase project. Reached by
the standard `DATABASE_URL` connection string, so the code stays provider-neutral
(portable to any Postgres later). Being off-dyno also de-risks the P4 Heroku move — the
stash never touches Heroku's ephemeral filesystem (CLAUDE.md).

**Tooling — Supabase CLI.** Link the project (`supabase link`) and drive schema through
**versioned migrations** (`supabase migration new` / `db push`), checked into
`supabase/migrations/`. This gives repeatable, reviewable schema changes instead of
hand-run SQL. (Getting connected to the Supabase CLI is a setup step before build.)

**One backend everywhere.** Local pm2 and production both point at Supabase via
`DATABASE_URL`. Use a **separate dev database/branch** (Supabase branch or a `_dev`
schema) for local so testing never touches live inventory. `guildConfig` and
`latchStore` stay on `fileStore` — only the stash needs the real DB.

Connection: a single pooled client (`pg` or `postgres.js`) created once at boot from
`DATABASE_URL`; the repository is the only importer. Add `DATABASE_URL` to `.env` /
`.env.example` and (later) Heroku config vars.

---

## Request model & roles

The point is *fair* distribution to new and established players, so the request flow
matters more than the tech.

**Flow (request → approve → sent, three states, two Manager actions):**

1. A **Twink-role** member browses (`#stash` panel or `/stash list`) and clicks
   **Request** / runs `/stash request` → a `pending` request lands in the Manager
   queue. No unit is reserved; multiple members may request the same item.
2. A **Manager** reviews the queue (`/stash queue`) and `/stash approve`s one requester
   → that request is `approved` and reserves a unit. (First action.)
3. After the in-game mail/trade lands, the Manager runs `/stash sent` → request `sent`,
   `remaining` decrements, panel updates. (Second action.) An approval left un-sent for
   **5 days** auto-reverts to `pending` so the unit is not stuck.

**Fairness levers (per-guild config):**

- **Active-request cap = 3** — max simultaneous open (`pending`/`approved`) requests
  per user, so nobody floods the queue.
- **One active request per item per user**; Managers can reverse/re-open any decision.
- No new-member priority and no cooldown — Managers decide fairness by hand.

Anti-abuse: every add / request / approve / deny / sent / remove / expire is written to
the audit sink (`src/lib/audit.js`) so Managers have a full trail and can undo.

**Stale-approval sweep.** A lightweight periodic job (reuse the timers scheduler
pattern) calls `expireStaleApprovals` per guild to revert 5-day-old approvals. Runs
in-process; no extra infra.

---

## Slash commands

**Enduser (`/stash list` open to all; `request`/`mine`/`cancel` Twink-role gated):**

| Command | Does |
| --- | --- |
| `/stash list [slot:] [tag:]` | browse available items, ephemeral + paginated (open to all) |
| `/stash request item:<autocomplete>` | request an item (enters the Manager queue) |
| `/stash mine` | your active requests + their status |
| `/stash cancel item:<autocomplete>` | withdraw one of your requests |

**Manager (Manager-role gated):**

| Command | Does |
| --- | --- |
| `/stash add name: [wowhead:] [qty:] [slot:] [donor:@user] [notes:]` | add one item |
| `/stash bulk` | intake the big donation batch — modal/paste of one item per line |
| `/stash queue [item:]` | view the pending-request queue |
| `/stash approve request:<autocomplete>` / `/stash deny request:` | resolve requests |
| `/stash sent request:<autocomplete>` | confirm hand-off → decrement stack (closes at 0) |
| `/stash remove item:<autocomplete>` | withdraw an item |
| `/stash panel post\|refresh\|remove [channel:]` | manage the live panel (mirrors `/panels`) |

`add` can autocomplete `name`/`slot` against the content gear registry where an item
exists there, but the stash is free-form (donations include off-meta gear), so free
text is always allowed. `bulk` is the donor use-case — one Manager pastes the whole
list once. `donor` on `add` is stored as a Manager-only note, never shown publicly.

---

## Panel system (`#stash`)

Mirrors the enduser-panels architecture (`08`) — persistent bot-owned embeds, a
component router, the shared-service rule — with two deliberate differences.

**Difference 1 — the panel is a live view of mutable data.** Content panels are static
and only re-render on `/panels refresh`. The stash panel must **edit itself on every
state change** (item added / requested / given / removed), like the timer board
auto-updates its message. On each mutation a small renderer edits the stored panel
message(s). Debounce rapid changes.

**Difference 2 — buttons write state.** `08`'s non-goal ("controls expose enduser reads
only, never state-writing behind a public button") is **intentionally relaxed here**,
with guardrails:

- The public panel is a compact **browse** surface (category buttons or a select), open
  to anyone to view. Clicking a category returns an **ephemeral** filtered list; the
  actual **Request** button lives on that private follow-up. Keeps the public message
  clean and one user's requesting out of everyone else's face.
- The write behind the public button is only a **request insert** — non-exclusive,
  reversible, idempotent. Nothing is allocated; the exclusive step (approve) is
  Manager-only, off the public panel.
- Request writes are **rate-limited** per user and **fully audited**; nothing
  destructive is one public click away (remove / approve / deny / sent are Manager
  slash commands only).
- The **Request** button is gated to the **Twink role** — a non-Twink click gets an
  ephemeral "you need the Twink role to request" reply. Browsing is open to everyone.

**customId contract:** new namespace **`s1|…`** (separate from panels' `p1`), same rules
— pipe-delimited, ≤100 chars, versioned, slug/opaque-id only, never free text. Examples:
`s1|browse|weapon`, `s1|request|itm_a1b2c3`, `s1|mine`, `s1|cancel|req_x9y8z7`. A version
bump (`s1`→`s2`) routes stale buttons to an "out of date, ask a Manager to refresh" path.
Router extends the existing `interactionCreate` button/select branch, dispatching `s1`
to a `src/components/stash.js` handler registry.

**Flow example:** `s1|browse|head` → ephemeral list of available head items, each row a
Request button `s1|request|<itemId>` → click → Twink-role check → `requestItem` inserts a
pending request → ephemeral "requested, a Manager will review" → panel message updates
the item's request count.

---

## Per-guild config additions

Extend the guild config (`config/guildConfig.js` `DEFAULT_CONFIG`), independent of
`alertChannelId` / `timerBoard` / `panels`, default `null`:

```json
"stash": {
  "channelId": "…",
  "panelMessageIds": { "browse": "…" },
  "requesterRoleIds": ["…"],
  "managerRoleIds": ["…"],
  "requestCap": 3,
  "staleApprovalDays": 5
}
```

- `requesterRoleIds` — the **Twink role**(s) allowed to request (browsing is open).
- `managerRoleIds` — the **Manager role**(s) that approve/deny/send.
- `requestCap` — max open requests per user (default 3).
- `staleApprovalDays` — approvals older than this revert to the queue (default 5).
- Inventory and requests do **not** live in guild config (config holds wiring, not bulk
  mutable data) — they live in Postgres. Config only points at the channel/panel and
  holds policy knobs.

---

## Access / roles

Reuse the hardened access model (P5 #9, `src/lib/access.js`):

- **Browse** (`/stash list`, viewing the panel): **open to everyone** in the server.
- **Request** (`/stash request`, `mine`, `cancel`, the panel Request button): gate on
  the configured **`stash.requesterRoleIds`** (Twink role). Non-holders get an
  ephemeral hint.
- **Manager** (add / bulk / queue / approve / deny / sent / remove / panel): gate on
  **Manage Server** OR a configured **`stash.managerRoleIds`** (Manager role). Keep
  `stash.managerRoleIds` separate from the bot-admin `DISCORD_ADMIN_ROLE_IDS` so a
  Manager runs the stash without full bot-admin power.

---

## Non-goals / guardrails

- **No real-money / trading.** Free giveaway to guildies; no pricing, no bidding.
- **No auto-mailing.** The bot tracks intent, request, and approval; the actual in-game
  hand-off is manual (a Manager marks `sent`). The bot never touches the game client.
- **No destructive public buttons** — remove / approve / deny / sent are Manager slash
  commands. The only public write is a non-exclusive Request insert.
- **No public donor attribution** — donors are recorded Manager-only and announced by
  hand; no leaderboard.
- **Inventory is state, not authored content** — never in `data/content/`, never loaded
  by the content store.
- **Durability is mandatory** — Postgres (Supabase) via `DATABASE_URL`; never a
  file-backed stash on ephemeral hosting.

---

## Implementation preflight (code review, 2026-08-11)

Read against the live code (`package.json`, `guildConfig.js`, `access.js`, `audit.js`,
`index.js`, `timers/loop.js`, `timers/board.js`, `ci.yml`). This is the bot's **first
database dependency** (current deps: discord.js, dotenv, luxon, pino — no DB), so the
risk clusters there. Blockers must be resolved before coding; recommended resolutions
noted.

### Blockers

1. **Test strategy vs. a secretless CI.** `ci.yml` runs only `npm ci → lint →
   format:check → npm test` on a bare runner — no `DATABASE_URL`, no Postgres service,
   no secrets — and `npm test` (`node --test`) runs everything in `test/`. The whole
   codebase deliberately keeps unit tests secretless (`audit.js`/`access.js`/`logger.js`
   read `process.env` directly to dodge `env.js`'s fail-fast). "Approve is atomic" is
   unprovable against a mock or pg-mem (no `SELECT … FOR UPDATE`) and can't reach
   Supabase from CI.
   **Resolution:** split the suite — pure logic tests stay in `npm test` (CI as-is);
   SQL/concurrency integration tests run against an **ephemeral Postgres `services:`
   container** via a separate `npm run test:int` (free, secretless, not in the default
   run). Ensure the pg pool closes so `node --test` doesn't hang on an open handle.

2. **A DB failure must not take out the whole bot.** `index.js` awaits
   `loadCommands()` + `loadContentStore()` at top-level eval; a throw exits the process.
   Adding `await createPgPool()` at boot would let an unreachable Supabase / bad URL kill
   timers, panels, and every reference command.
   **Resolution:** **lazy-connect**; degrade only the stash ("stash temporarily
   unavailable") while the rest runs. Make `DATABASE_URL` **optional** (stash disabled
   when absent) and read it outside `env.js`'s fail-fast, mirroring `AUDIT_LOG_CHANNEL_ID`.

3. **Supabase connection specifics (will fail the first connect otherwise).** Pin:
   pooler vs direct (**direct is IPv6-only now** without the IPv4 add-on → local Windows
   + Heroku likely need the **Supavisor pooler / IPv4**); transaction-mode pooling (6543)
   disables prepared statements (`postgres.js` needs `prepare:false`; `pg` mostly fine);
   `sslmode=require`. The multi-statement `FOR UPDATE` txn is fine under transaction
   pooling on one checked-out connection.
   **Resolved:** `pg` + Supabase **Session pooler** (IPv4, 5432) + `sslmode=require`,
   small pool.

4. **Migration authority + local DB.** Never run migrations from the bot at boot — apply
   via the Supabase CLI (`db push`) manually/CI. "Dev branch/schema for local" is heavier
   than needed; a separate free dev **project** or a `_dev` schema is simpler.
   **Resolved:** separate free Supabase **dev project** for local/tests; migrations via
   Supabase CLI `db push` (human/CI), never bot-on-boot.

### Significant gaps (decide now, build during)

- **Request-cap (3) race.** The `count > 3` check is read-then-insert; rapid clicks on 4
  items race. Enforce with a per-user advisory lock / `SELECT count … FOR UPDATE`, or
  explicitly accept a rare off-by-one. (The unique index only covers one active request
  per (item,user).)
- **Autocomplete must not hit Supabase per keystroke.** Discord gives 3s / ≤25 choices;
  existing autocompletes serve from the in-memory content cache. Keep a **per-guild
  in-memory item cache** (invalidated on mutation) that backs both autocomplete and the
  panel render.
- **Panel refresh.** `board.js` edits one message once per 60s (no debounce needed);
  per-mutation edits are bursty and hit Discord edit limits. Public message = compact
  **category/counts** board (full list stays ephemeral — embeds cap 25 fields / 6000 ch /
  4096 desc). **Recommend refreshing the public panel on the existing 60s tick** (reuses
  the proven board path, sidesteps rate limits; ≤60s counts staleness is fine), or a
  5–10s debounce if snappier is wanted.
- **Requester notifications (missing).** DM the requester on approve (with hand-off
  instructions) / deny / sent, reusing the existing DM fan-out (`dmEnabled`, GuildMembers
  intent, `delivery.js`), with a DMs-closed fallback.
- **Remove-with-active-requests.** Removing/withdrawing an item must cascade its
  pending/approved requests to `cancelled`/`denied` + notify.
- **Two new async access gates.** `access.js` only has the admin gate, and its role IDs
  come from **env**; Manager/Twink roles come from **per-guild config**. Add async
  `requireManager` / `requireRequester` that load guild config then check
  `member.roles.cache`. Manage Server always satisfies Manager. Decide whether a Manager
  lacking the Twink role may still request.

### Nits

- **New command ⇒ `npm run deploy`.** One `/stash` with mixed subcommands can't hide
  Manager subs via `setDefaultMemberPermissions` (whole-command only) — decide `/stash`
  (enduser) + `/stashadmin` (manager) vs. runtime-only gating.
- **Audit for `s1|`.** `audit.js`→`describePanel`→`parseCustomId` only knows `p1`
  (`PANEL_ACTION_LABELS`); `s1` clicks log as "unknown control." Extend audit + route
  `s1`→`components/stash.js` in `index.js` (currently hardcodes `handleComponent`).
- **Shallow config merge.** `{ ...DEFAULT_CONFIG, ...stored }` won't backfill new nested
  `stash` keys into already-saved guilds — use functional patches + read-with-fallback.
- **`bulk` dedupe/idempotency** — re-paste shouldn't double-insert; decide duplicate
  names → stack vs separate rows (separate is simpler for BoE uniques).
- **Guard `donor` is never rendered** (anonymous) — add a test.
- **State the stack invariant:** `remaining` = physical units, decremented only on
  `sent`; approvals are reservations derived from `count(approved)`; the 5-day expiry
  frees a reservation with no double-decrement.

### Positives (don't over-correct)

Postgres row locks make approve **process-safe** — even a stray second instance can't
oversell (the old in-process `withLock` couldn't guarantee that). `stash: null` default
matches the existing null-until-configured pattern. GuildMembers intent is already on, so
role gating works. `board.js` (edit/repost self-heal) and `loop.js` (`createTickLoop`)
are reusable for the panel refresh and the stale-approval sweep — piggyback the sweep on
the existing 60s tick rather than a second interval.

### All resolved

Every review item is now settled in **Build decisions** above (test split, driver +
connection, local DB + migration runner, command split, panel tick-refresh, cap race,
requester gate, bulk intake). Ready to start with the test harness → migration →
repository.

---

## Sequencing / dependencies

1. **Supabase setup:** get connected to the Supabase CLI, link the project, create the
   `stash_items` / `stash_requests` migration in `supabase/migrations/`, add
   `DATABASE_URL` (prod + a dev project/schema) to `.env` / `.env.example`. Migrations
   applied via CLI, never by the bot at boot.
2. Boot a **lazy** pooled Postgres client from `DATABASE_URL` (optional; stash disabled
   if absent), isolated so a DB outage can't kill timers/panels/reference commands.
3. Build `src/stash/store.js` repository. Unit tests (against the dev database or a
   transactional rollback harness): approve is atomic and never oversells a stack,
   `remaining` draw-down + `given` at 0, request cap (3) enforced, idempotent requests,
   stale-approval expiry, full status lifecycle.
4. Slash commands against the repository (browse open; request Twink-gated; Manager
   commands gated via P5 #9 access).
5. `#stash` panel: live-editing renderer + `s1` component router (browse → ephemeral
   request), reusing the `08` component/service patterns.
6. Wire mutators to the audit sink; add the periodic stale-approval sweep (timers
   scheduler pattern).
7. **P4 tie-in:** because the stash is already on off-dyno Supabase Postgres, the Heroku
   move needs only the Procfile + config vars (no stash re-platforming).

Built on: enduser-panels architecture (`08`), P5 #9 access model (`13`), the audit
sink, and per-guild config (`03`).

---

## As built (shipped 2026-08-12)

The feature shipped in vertical slices; this section records what actually landed and the
deltas from the plan above. The plan's locked decisions all held — these are refinements
found during build, not reversals.

### Command surface (as shipped)

Split into two commands, exactly as the "command shape" decision called for:

- **`/stash`** (enduser): `list`, `request`, `mine`, `cancel`. Browse open to all;
  request/mine/cancel gated on the Twink (requester) role.
- **`/stashadmin`** (Manager; `setDefaultMemberPermissions(ManageGuild)` picker hint +
  runtime `requireManager`): flat subcommands `add`, `list`, `queue`, `approve`, `sent`,
  `deny`, `remove`, plus three subcommand **groups**:
  - `panel post|refresh|remove` — manage the public `#stash` panel message.
  - `roles add|remove|clear|show` — edit `requesterRoleIds` / `managerRoleIds`.
  - `config channel|set|show` — manager notify channel; `set` tunes `request_cap` (1–25)
    and `stale_approval_days` (1–60); `show` prints all stash config.
  - The **`roles` and `config` groups additionally require Manage Server** (checked after
    defer), tighter than the command-wide `requireManager`, so a plain Manager can't grow
    the roster or rewire notifications (self-escalation guard).

The planned **`/stash bulk`** batch-intake is **not yet shipped** — single `add` only.

### Store API (as shipped) — `src/stash/store.js`

Signatures that drifted from the plan's sketch:

- `isEnabled()` — Boolean of `DATABASE_URL` present; every command/timer short-circuits on
  it so the stash degrades gracefully when unconfigured.
- `requestItem(guildId, itemId, userId, { requestCap })` — cap is passed in from guild
  config (default 3), enforced under a per-user advisory lock.
- `listItems(guildId, { statuses, limit })` / `listRequests(guildId, { statuses })` —
  status **arrays**, not the single `status?/slot?/tag?` filter originally sketched.
- `approveRequest` / `markSent` / `denyRequest` / `cancelRequest` — each returns the mapped
  request `{ id, userId, itemId, status, … }` (the return shape backs the requester DMs).
- `expireStaleApprovals(guildId, { staleApprovalDays = 5, now = new Date() })` →
  `{ reverted, itemIds, requests }`, where `requests` is the reverted rows
  `[{ id, userId, itemId }]` — added so the sweep can DM each affected requester.
- Item statuses `available|requested|given|withdrawn`; request statuses
  `pending|approved|sent|denied|cancelled`. Failures surface as `StashError { code }`,
  which the commands map to friendly text.

### Notifications (`src/stash/notify.js`)

The plan flagged requester notifications as a gap; shipped as best-effort, fire-and-forget
helpers that never block or fail the triggering action:

- **Manager channel** — on a new request, if `stash.managerChannelId` is set, one embed
  posts there and pings the Manager role(s). Opt-in (no channel → no notify).
- **Requester DMs** — on `approve` / `sent` / `deny`, DM the requester the outcome.
  Always-on best-effort (no per-guild toggle); closed DMs are logged-once and swallowed.
- **Expiry DM** — the stale-approval sweep DMs each requester whose approval reverted to
  pending (`kind: 'expired'`).

### Panel refresh + stale sweep (`src/timers/stash.js`)

Refreshes the public panel on the existing 60s tick (per-guild, isolated try/catch,
`editOrRepost` self-heal on `UNKNOWN_MESSAGE = 10008`), but only when a **fingerprint**
(`id:status:remaining` per item) changed since the last tick — an untouched guild is never
edited. Trade-off: a manually-deleted panel self-heals on the next stock change or
`/stashadmin panel refresh`, not every tick. The same tick runs the stale-approval sweep
first, freeing reserved units before it renders.

### Config keys (as shipped)

The `stash` config block gained **`managerChannelId`** (manager notify channel) on top of
the planned `channelId`, `panelMessageIds`, `requesterRoleIds`, `managerRoleIds`,
`requestCap`, `staleApprovalDays`. Written via a functional `setStash(guildId, patch)`
merge that preserves sibling keys; `patch === null` clears the whole block. Note this
wiring still lives in per-guild `guildConfig` under `data/` (only the inventory/requests
are in Postgres) — relevant to the P4 Heroku durability prereqs.

### Wowhead item links (shipped 2026-08-13)

Items added with a `wowhead_id` render their name as a masked Wowhead Classic link in
the public panel description (`**[name](https://www.wowhead.com/classic/item=<id>)**`),
reusing `itemNameMarkup` / `wowheadItemUrl` from `services/gearFormat.js` so the look
matches `/bis`, `/gear`, `/item`. Because the `add` option is free text, a new
`normalizeWowheadId` (in `services/stash.js`) guards both ends: it accepts a bare id or a
pasted Classic URL (extracts `item=(\d+)`) and yields null for anything else, so the
render **never emits a broken link**. Applied at intake (canonical id stored) and again at
render (defends legacy rows). The request select, `/stashadmin list`, and DMs stay plain —
masked links don't render in select-option labels, and the manager list leads with the
copyable id. Render-only + handler-only, but the `wowhead_id` option description changed
("id or URL") so it needed a `deploy`.

### Deferred follow-ups

- `/stash bulk` batch intake.
- Optional `stash.notifyRequesters` opt-out toggle (DMs are always-on today).
- P4 Heroku durability for the `data/`-backed stash **config** block (inventory is already
  off-dyno on Supabase).

## Planned: item-slot taxonomy + panel grouping (2026-08-13)

Refines the earlier slot review (Q1-Q3) to the **preferred item-slot set** taken from the
in-game equipment-slot dropdown (screenshots) - pure WoW *equipment* slots, since the guild
stash is primarily gear. Non-gear donations (consumables, mats) simply omit `slot` and fall
under a trailing **Ungrouped** bucket at render, so the taxonomy stays clean without losing
the donation-pile flexibility.

### Canonical slot vocabulary

Exactly the slots shown in the dropdown, plus **Weapon** (added per request). `value` is the
stored canonical id; `label` is the choice / section display. Rendered and ordered in
paper-doll order, Ungrouped last.

| value | label |
|---|---|
| head | Head |
| neck | Neck |
| shoulder | Shoulder |
| back | Back (Cloak) |
| shirt | Shirt |
| chest | Chest |
| wrist | Wrist |
| hands | Hands |
| waist | Waist |
| legs | Legs |
| feet | Feet |
| finger | Finger |
| trinket | Trinket |
| weapon | Weapon |
| offhand | Held In Off-hand |
| shield | Shield |
| ranged | Ranged |

17 values - well under Discord's 25-choice cap. `shield` (Shield) and `ranged` (Ranged / Wand)
are **added** (confirmed) on top of the screenshot set; `tabard` (Tabard) is intentionally
omitted as cosmetic. (Superseded my earlier draft's Consumable/Material/Other buckets -
non-gear items go slot-less into Ungrouped instead.)

### Slice A - `/stashadmin add slot` becomes a dropdown (was Q3) - shipped 2026-08-13

- Convert the free-text `slot` option to `.addChoices(...)` over the table above.
- **Keep it optional** - a no-slot donation renders under Ungrouped; that is how
  consumables/mats live inside a gear-slot taxonomy.
- **No DB migration** - the `slot` column already exists; this only constrains new intake.
- **Legacy rows** (free-text `slot` from before) are tolerated: unknown slots fall to
  Ungrouped. Optional `normalizeSlot()` alias map folds common legacy strings in
  (`gloves` -> hands, `boots` -> feet, `bracer` -> wrist, `cloak` -> back,
  `mainhand`/`2h-weapon` -> weapon).
- **Deploy:** the option definition changes, so this needs `npm run deploy` (same as the
  wowhead option), then a `pm2 reload`.

### Slice B - panel grouping + sort (was Q1 + Q2) - shipped 2026-08-13

- Group the panel **description** by slot in canonical order (Ungrouped last); sort items
  **by name** within each group.
- Use **in-description bold subheaders** (`**Hands**`), NOT embed fields - one truncation
  point (the existing 4096-char cap), degrades gracefully, and dodges the per-field
  1024-char limit.
- Only render non-empty groups; keep the empty-stash degrade state untouched.
- Order the **request select** the same way (slot -> name) so the dropdown matches the
  visual list.
- **Pure render change** in `buildStashPanel` - fully unit-testable, no deploy, `pm2 reload`
  only.
- **As built:** `groupBySlot()` produces the shared ordered `{ label, items }[]` consumed by
  both the description subheaders and `orderedOpen` (the select). The redundant per-line
  `(slot)` annotation was dropped since the subheader now carries it. A `normalizeSlot()`
  export folds canonical ids as-is plus legacy free-text synonyms (`gloves->hands`,
  `boots->feet`, `bracer(s)->wrist`, `cloak->back`, `ring->finger`, `mainhand`/`2h`/
  `2h-weapon`->`weapon`, `off hand`/`off-hand`->`offhand`); unknown text falls to Ungrouped
  so a typo can't fragment the layout. The select-option description reuses the canonical
  slot label via `SLOT_LABEL`.

### Sequencing

Slice A first (clean data + drives manager adoption), Slice B second (presentation rides on
normalized slots). Both low-risk; B only pays off once managers actually fill slot, which the
A dropdown encourages by removing free-text friction.

## Planned: interactive controls + a separate Manager Panel (2026-08-14)

Goal: kill the last id-typing friction (`approve`/`sent`/`deny`/`remove` all still take a
copy-pasted id) with button/select controls, and give managers a persistent console instead
of re-running slash commands. Reframe first, because half the ask is already done and half
was aimed at the wrong surface.

### What already exists (don't rebuild)

- **Requesting is already id-free.** The public panel emits an `s1|req` select of claimable
  items (Slice B orders it by slot -> name). Requesters pick from a list; no id entry.
- **`/stashadmin queue status:<pending|approved|active>`** (shipped 2026-08-14) is the
  text-only precursor to the manager console below — it surfaces the previously invisible
  approved-but-unsent queue. The interactive panel just puts buttons on that same data.

The real friction is manager-side (`approve`/`sent`/`deny` need a `request_id`, `remove`
needs an `item_id`). That is what these controls remove.

### Key decision: manager controls go on a SEPARATE panel in a manager-only channel

Do **not** put manager buttons on the public browse panel — it's a single shared message the
whole guild sees, so manager tooling there is both a visual-clutter and a
information-leak problem (even with click-time gating). Instead post a **second persistent
panel** (the *Manager Panel*) into a **manager-only channel**. Channel permissions are the
primary gate; click-time `requireManager` is defense-in-depth (never trust the channel
alone). This cleanly separates: public panel = requester controls; manager panel = manager
controls.

### Manager Panel layout

A persistent, tick-refreshed message with:

- **Dashboard embed** — counts: N pending, N approved-awaiting-hand-off, N available items,
  low-stock flags. At-a-glance state without running a command.
- **Row 1 — Pending select** (`s1|mq`): options = pending requests (<=25), label
  `user -> item`. The chosen value is the `reqId`.
- **Row 2 — Approved select** (`s1|maq`): options = approved-awaiting-hand-off requests.
- **Row 3 — buttons**: **Refresh** (`s1|mref`); optional **Add Item** (modal, see caveat).

**Critical interaction rule — spawn ephemeral, never edit the shared message.** Because the
Manager Panel is shared across managers, a select/button must NOT edit it in place (that
would stomp other managers' views and race the tick refresh). Instead, selecting a request
**spawns an ephemeral action message** for just that manager: a summary + **Approve** /
**Deny** buttons (for pending) or **Mark Sent** (for approved), each with the `reqId` encoded
in its customId. The shared panel stays stable; per-manager actions are isolated. This is the
same ephemeral-console pattern the interactive `/stashadmin queue` can reuse, so both entry
points (panel select OR slash queue) lead to identical action handlers.

### customId grammar (extends the `s1|` namespace)

- `s1|mq` — manager Pending select (chosen value = `reqId`)
- `s1|maq` — manager Approved select (chosen value = `reqId`)
- `s1|mref` — manager panel Refresh
- `s1|aprv|<reqId>` — approve (ephemeral button)
- `s1|deny|<reqId>` — deny, step 1: re-renders a **Confirm deny?** Yes/No (destructive
  actions require a second click)
- `s1|denyc|<reqId>` — deny, confirmed
- `s1|sent|<reqId>` — mark sent
- `s1|wdrw|<itemId>` / `s1|wdrwc|<itemId>` — withdraw item + confirm (Phase 2)

customId must stay <=100 chars; `reqId`/`itemId` are short prefixed ids, so ample headroom.
All handlers are **stateless** (id rides in the customId) — no in-memory collectors that die
on `pm2 reload`, matching the existing `s1|action|arg` routing in `components/stash.js`.

### Config + storage

Extend the `stash` guildConfig block:

- Add `panelMessageIds.manager` alongside the existing `panelMessageIds.browse`.
- Add a distinct **`managerPanelChannelId`** (do NOT overload `managerChannelId`, which is the
  *notify* channel — they may differ, though often the same). Still `data/`-backed, so this
  is part of the P4 Heroku durability move.

### Admin surface to manage it

Extend the existing `panel` subcommand group rather than inventing a new one. Add a
`kind:<browse|manager>` choice option to `panel post|refresh|remove` (default `browse` to
preserve today's behavior). Command-definition change -> needs `npm run deploy`. The
`renderStashPanel`/`removeStashMessage` helpers generalize to a `kind` arg.

### Tick refresh

The 60s tick already fingerprint-refreshes the browse panel. Add a parallel fingerprint for
the manager panel (pending + approved request sets, plus item counts) and refresh it on the
same tick when it changes. Same isolated try/catch + `editOrRepost` self-heal.

### Add Item via modal — decision (updated 2026-08-14, greenlit)

Superseded the earlier "lean (b), skip the modal" caveat. The old worry was that modals are
text-input-only so `slot` would regress from Slice A's dropdown — but `normalizeSlot` already
folds free-text slots (`bracer -> wrist`, unknown -> Ungrouped), so a free-text slot input is
acceptable and **loses no taxonomy**. Plan: an **Add Item** button (shares the Refresh button
row — the panel is at 4/5 rows worst-case, so new *actions* must be buttons that share a row,
never new selects) opens a modal with **5 text inputs** — name (required), quantity, slot,
wowhead id/link (`normalizeWowheadId` accepts a bare id or a pasted Classic URL), donor;
`tags`/`notes` stay on the slash command (Discord caps a modal at 5 inputs).

**Prereq — modal-submit routing.** `index.js` currently forks only
`isButton() || isAnySelectMenu()` to the stash router; a `ModalSubmitInteraction` falls
through to the command guard and is **silently dropped**. Add an `isModalSubmit()` branch that
forks `s1|`-prefixed submits into `handleStashComponent` (the `parseStashCustomId` codec
already handles any `s1|` id, so the router needs only a new action handler). Reload-only —
modals/buttons are not command definitions, so no `deploy`.

**Submit runs the add-time dedup path (below)** — the modal and the slash command share one
match->restock code path.

### Concurrency + stale controls (already safe)

Store guards (`REQUEST_NOT_PENDING`, `REQUEST_NOT_APPROVED`) mean two managers racing the same
request get a clean `StashError`; the handler surfaces it and re-renders current state rather
than erroring hard. A stale panel select (referencing an already-decided request) hits the
same guard — no corruption possible.

### Phasing

1. **Phase 1 — Manager Panel MVP**: dashboard embed + Pending/Approved selects, each spawning
   an ephemeral Approve/Deny/Mark-Sent console. Kills `approve`/`sent`/`deny` id entry.
   Needs: `panel kind:manager` subcommand option (deploy), new component routes (reload),
   config shape extension, tick refresh.
2. **Phase 2 — Withdraw flow**: item select (on manager panel or `/stashadmin list`) ->
   ephemeral Withdraw confirm. Kills `remove item_id`.
3. **Phase 3 (defer)** — slot-first requester navigation on the public panel (slot select ->
   item select) to beat the 25-option cap once inventory routinely exceeds ~20 items.

Deploy/reload: Phase 1 needs one `deploy` (the `panel kind` option); everything else is
component routing -> reload-only.

> **Status (2026-08-14):** Phase 1 (interactive approve/deny/sent console) and Phase 2
> (withdraw) are **shipped**. As-built customIds drifted from the sketch above: withdraw is
> `s1|wdc|<itemId>` / `s1|wdcx|<itemId>` (not `wdrw`/`wdrwc`), and the console adds an
> in-panel Withdraw select `s1|mwd`. Panel row budget is now pending (`mq`) + approved
> (`maq`) + withdraw (`mwd`) selects + a Refresh (`mref`) button row = **4 of 5 rows**.

## Planned: add-time dedup + wowhead inheritance (2026-08-14)

Problem (observed): re-adding an item that already exists — exact name, e.g. "Staff of the
Blessed Seer" — creates a **duplicate row**, and you must re-type the `wowhead_id` you already
entered once. Root cause: `store.addItem` unconditionally `insert`s a fresh `itm_…` row; it
never looks for an existing match. Two asks, one fix: make add **match-and-restock** instead
of blind-insert, and inherit the existing wowhead id on a match.

### Identity / match key

- **Tier 1 — `wowhead_id`** (canonical) when the incoming add supplies one. Exact identity.
- **Tier 2 — normalized name** `lower(btrim(name))` for id-less items.
- **Scope: active rows only** — `status in ('available','requested','given')`. **Never match a
  `withdrawn` row** (it was deliberately pulled; add a fresh row instead of resurrecting it).
- **Conflict rule:** a name match only merges when there is **no wowhead-id conflict** — if the
  add carries id `W`, a candidate must have `wowhead_id` null or `= W`. Differing ids ⇒ distinct
  same-name variants ⇒ insert new. A no-id add matches any name candidate, and **prefers one
  that already has an id** so we inherit it.

### Behavior on match — restock, don't duplicate

When a compatible active candidate exists, **restock the earliest** instead of inserting:

- `quantity += N, remaining += N` together — keeps the `remaining_within_quantity` and
  `quantity > 0` checks satisfied; a `given`/exhausted row flips back to `available` via
  `recomputeItemStatus`.
- **COALESCE-backfill** `wowhead_id` and `slot` (fill only when the existing row is null), so
  the id entered on the first donation is inherited and never re-typed.
- Keep existing `donor`/`notes` — a restock shouldn't overwrite provenance. *Decision to
  confirm:* silently keep vs. append the new donor to `notes`. Recommend keep + log.
- Report exactly what happened: "Restocked **Staff of the Blessed Seer** → ×N (`itm_…`)."

No match ⇒ insert as today.

### UX shape — recommend auto-restock + report + a `force_new` escape (stateless)

"Same normalized name, no id conflict" almost always **is** the same WoW item, so act
immediately and report rather than gating every add behind a confirm click:

- **Default:** exact-key match ⇒ restock + a clear, reversible report (wrong? withdraw +
  re-add). Fully stateless — no in-memory pending-add collector to die on `pm2 reload`.
- **Escape hatch:** a `force_new:true` boolean on `/stashadmin add` (and an "Add as separate
  entry" affordance in the modal) for the rare genuinely-distinct same-name case.
- *Alternative considered — button confirm (Restock / Add new / Cancel):* safer against an
  accidental name collision, but "Add as new" needs the full free-text payload, which can't
  ride a ≤100-char customId, forcing a short-lived in-memory pending-add token (a deliberate
  exception to the stateless rule; graceful loss on reload). Deferred as optional polish;
  auto-restock is simpler and stays stateless.

### Legacy dupes already in the DB (the screenshot)

Going-forward dedup won't retro-merge existing duplicate rows — a one-time **consolidation** is
needed:

- Merge same-key active rows into the earliest: sum `quantity`/`remaining`; **re-point open
  (`pending`/`approved`) requests** to the survivor (`update stash_requests set item_id = …`)
  **before** retiring the dupe; mark the emptied dupe `withdrawn` — do **not** `delete` it (the
  `stash_requests` FK is `on delete cascade`, so a delete would nuke that row's `sent`/`denied`
  history too).
- Deliver as a `/stashadmin` maintenance action or a scripted one-off via the Supabase CLI —
  **never at boot**. Dry-run / report first.

### Optional DB-level guard (defense in depth)

A **partial unique index** `unique (guild_id, wowhead_id) where wowhead_id is not null and
status in ('available','requested','given')` stops future id-keyed dupes at the DB. Name
uniqueness can't be safely enforced (case/whitespace + legit same-name variants), so name dedup
stays app-side. The index **fails to build while id-keyed dupes exist**, so it runs **after**
consolidation, via CLI `db push` — not at boot.

### Store surface (new)

- `findItemMatch(guildId, { wowheadId, name })` → compatible active candidate(s), `created_at
  asc`.
- `restockItem(guildId, itemId, addQty, { wowheadId, slot } = {})` → txn + `FOR UPDATE`; bump
  qty + remaining; COALESCE-backfill id/slot; `recomputeItemStatus`. Keep `addItem` as the pure
  insert for the no-match / `force_new` path.

### Sequencing (folds into the greenlit Add-Item modal)

The match+restock logic is entry-point-agnostic — one code path serves the slash command and
the modal:

1. **Store:** `findItemMatch` + `restockItem` (+ tests). *(reload-only)*
2. **Slash `/stashadmin add`:** route through match→restock; add a `force_new` boolean.
   *(definition change ⇒ `deploy`)*
3. **Add-Item modal:** modal-submit routing prereq in `index.js` (`isModalSubmit` → stash
   fork), `buildAddModal` (5 inputs), submit reuses the same match→restock path. *(reload-only)*
4. **Consolidation** of existing dupes (maintenance op / CLI), then the **optional** partial
   unique index. *(migration via CLI, not boot)*
