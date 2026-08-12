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

### Deferred follow-ups

- `/stash bulk` batch intake.
- Optional `stash.notifyRequesters` opt-out toggle (DMs are always-on today).
- P4 Heroku durability for the `data/`-backed stash **config** block (inventory is already
  off-dyno on Supabase).
