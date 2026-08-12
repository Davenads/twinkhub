# TwinkHub — project notes

WoW WSG-19 twinking Discord bot (discord.js v14, ESM). Handlers stay thin; game
knowledge lives in the JSON content store under `data/content/<bracket>/`, not in code.

## Commands / scripts
- `npm start` — run the bot (`node src/index.js`)
- `npm test` — `node --test` (unit tests under `test/`)
- `npm run deploy` — register slash commands (only when command *definitions* change)

Redeploy is NOT needed for presentational/content changes — only when a command's
name/options/description change. A code change requires restarting the bot process.

## Deployment / runtime

The bot runs under **pm2** on this Windows machine as app **`twinkhub`** (single fork
instance — see `ecosystem.config.cjs`). A Discord gateway bot must hold exactly one
connection per token, so never run a second instance alongside the pm2 one (it causes
duplicate replies and double timer pings).

Manage it:
- `pm2 start ecosystem.config.cjs` — start/adopt the bot under pm2
- `pm2 reload twinkhub` — zero-downtime restart after a code change
- `pm2 logs twinkhub` — tail logs
- `pm2 save` — snapshot the process list (required after add/remove for boot resurrect)

Boot persistence (survives reboot): `pm2-windows-startup` runs `pm2 resurrect` on login.
Install once: `npm i -g pm2-windows-startup && pm2-startup install`, then `pm2 save`.

Secrets live in `.env` (loaded by the app via dotenv) — never commit them or bake them
into pm2 config / the process list.

### Possible future migration — Heroku
We may move the bot to a **Heroku basic dyno with GitHub autodeploy** off `main`. Before
that migration, resolve these:
- Add a `Procfile`: `worker: node src/index.js` (a bot is a worker dyno, not `web`).
- Move `DISCORD_TOKEN` / guild ids from `.env` to Heroku **config vars**.
- **Durable storage:** Heroku's filesystem is *ephemeral* — anything written under
  `data/` (per-guild config, timer advance-warning latches) is wiped on every dyno
  restart/deploy. Move that mutable state to a real store (e.g. Heroku Postgres or an
  external KV) before cutover, or timers will double-fire and `/setup` will reset. The
  Community Stash *inventory* is already off-dyno on Supabase Postgres (needs no
  re-platforming), but its *wiring* (the `stash` config block — channel, roles,
  managerChannelId, tunables) still lives in `data/` guildConfig, so it's part of the
  same durability move.
- Drop the local pm2 setup once Heroku owns the runtime (don't run both against the same
  bot token).

## Community Stash (Postgres/Supabase)

A donated-item giveaway system (intake → browse → request → approve → hand-off). Unlike
the read-only content store, this is **mutable, transactional, durable** state, so it
lives in **Postgres on Supabase**, not `data/`. Full design + as-built notes in
`plans/14-community-stash.md`.

- **Storage seam:** `src/stash/store.js` is the ONLY module that touches SQL. Reached by
  `DATABASE_URL` (in `.env`); the pool connects **lazily** and the key is **optional** —
  absent/unreachable ⇒ `store.isEnabled()` is false and the stash disables gracefully
  while timers/panels/reference commands keep running. Never `await` a DB connect at boot.
- **Migrations:** schema lives in `supabase/migrations/`, applied via the **Supabase CLI**
  (`db push`) as a deliberate deploy step — **never by the bot at boot**.
- **Commands:** `/stash` (enduser: list/request/mine/cancel) + `/stashadmin` (Manager:
  add/list/queue/approve/sent/deny/remove, plus `panel`/`roles`/`config` groups; the
  `roles` and `config` groups additionally require **Manage Server**). Adding/renaming a
  subcommand ⇒ `npm run deploy`.
- **Access:** browsing is open; requesting gates on `stash.requesterRoleIds` (Twink role);
  Manager actions gate on Manage Server OR `stash.managerRoleIds`. All wiring lives
  per-guild under the `stash` config block (functional `setStash` merge), NOT in code.
- **customId namespace:** the public panel uses **`s1|action|arg`** (separate from content
  panels' `p1|…`); `index.js` forks stash components to `src/components/stash.js`.
- **Notifications** (`src/stash/notify.js`): best-effort, fire-and-forget — a manager
  channel ping on new requests (opt-in via `managerChannelId`) and requester DMs on
  approve/sent/deny/expiry. A notify failure must never block the triggering action.
- **Tick work** (`src/timers/stash.js`): refreshes the panel + sweeps stale approvals on
  the existing 60s tick, throttled by a per-guild fingerprint (only edits on real change).
- **Tests / CI (`.github/workflows/ci.yml`, two jobs):**
  - `test` — secretless: `npm ci` → lint → format:check → `npm test`. The DB-backed
    integration tests under `test/integration/` **self-skip** here (no `DATABASE_URL`),
    so this job stays green without a Postgres or secrets.
  - `integration` — runs `npm run test:int` against a throwaway `postgres:16` service
    container (`DATABASE_URL` = local container creds, not a secret). That container
    starts **empty**, so the harness **provisions its own schema** from
    `supabase/migrations/` via a module-eval top-level `await` before any test
    registers (guarded on `stash_items` existence, so an already-migrated dev DB is
    left untouched — no `DROP`). A `before` hook is *not* enough: at file scope it
    races the first tests' `beforeEach`, so the earliest cases would still die with
    `relation "stash_items" does not exist` (42P01) on a cold DB.
