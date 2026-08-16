<p align="center">
  <img src="assets/banner.jpg" alt="TwinkHub" width="100%">
</p>

# TwinkHub

A single, generalized **Discord bot for the WoW Classic Era twinking community** — starting
with the **10–19 Warsong Gulch (WSG)** bracket. Built on [discord.js](https://discord.js.org)
v14 (Node.js, ES modules).

TwinkHub folds three capability pillars into one bot:

1. **Data / knowledge commands** *(the main event)* — a wide surface of enduser slash
   commands answering "what gear / enchant / consumable / quest / spec / talents should I use,"
   plus curated guides and an optimization ("did you forget X?") pass. All game knowledge lives
   in a **modular, validated content store** (authored JSON) — adding a BiS item is a data edit,
   never a code change.
2. **Event timers** — a consolidated re-implementation of the recurring in-game event logic
   (BG Weekend, Arena Grand Master, Darkmoon Faire, STV Fishing) folded into this one process,
   with per-guild alerts, DM fan-out, and a self-refreshing timer board.
3. **Community Stash** — a donated-item giveaway system (intake → browse → request → approve →
   hand-off). Unlike the read-only content store, this is **mutable, transactional, durable**
   state, so it lives in **Postgres on Supabase**, reached through a single storage seam.

The data and timer pillars are reachable two ways: **slash commands** (primary, with
autocomplete) and — for the common enduser reads — **interactive panels** (persistent bot-owned
embeds with buttons/select menus that return ephemeral results through the same render logic).
The Community Stash has its own public panel plus a manager console.

---

## Project status

> **Shipping.** The bot runs in production under **pm2**. The timer engine, the content store +
> full data-command surface, interactive panels, and the Community Stash are all built and live.
> Bracket expansion (29 / 49) remains additive future work. See [Roadmap](#roadmap).

**What works today:**

- **Timers** — four `getState(now)` events (BG / AGM / DMF / STV), edge detection + advance-warning
  latches, three delivery modes (ping / broadcast / DM), `/events` + `/nextevent` reads, a
  self-refreshing `/timerboard`, and per-guild alert/DM toggles.
- **Data commands** — the full enduser surface (`/bis` `/gear` `/item` `/enchant` `/consumable`
  `/class` `/tierlist` `/quest` `/guide` `/optimize` `/xprules` `/statweights` `/pets` `/talents`
  `/spellcoef`) served from the validated content store with autocomplete.
- **Interactive panels** — persistent bot-owned embeds routed by versioned `customId`s, calling
  the same render functions the slash commands use.
- **Community Stash** — `/stash` (enduser) + `/stashadmin` (manager), a public browse panel and
  manager console, add-time dedup, tags, and a lifetime **Top Donors** leaderboard.
- **Access control** — Manage-Server / admin-role gating for admin commands, plus per-guild
  Manager / Requester role tiers for the stash.
- Runs under **pm2** as app `twinkhub` (single fork), with a 60 s tick driving timers + stash upkeep.

---

## Scope & game-version target

**All TwinkHub content targets the final, fully-unlocked state of WoW Classic Era.**

- **Flavor:** WoW **Classic Era** — the permanent, non-progressing pre-TBC servers (live
  client **patch 1.15.x**). This is where the modern 19 twink scene actually plays.
- **Content phase:** **post-Phase 6 (Naxxramas released)** — assume **all pre-TBC content,
  itemization, enchants, and recipes exist**. No phase-gating to reason about.
- **First bracket shipped:** **Level 19**, 10–19 WSG.
- **Designed to expand:** the content model is **bracket-namespaced from day one**
  (`data/content/<bracket>/…`), so adding **29 / 49 / beyond** is additive — no code changes,
  just data conforming to the schema.
- **Explicitly NOT targeted:** Season of Discovery (no runes/SoD items), Classic Anniversary /
  fresh progression realms, or TBC and beyond.

The target is encoded in data as `meta.json.gameVersion` per bracket so it's machine-checkable,
not just prose. See `plans/05-19-twink-domain.md` §"Game version target".

---

## Tech stack

| Concern | Choice |
|---|---|
| Runtime | Node.js **≥ 20** (LTS), ES modules (`"type": "module"`) |
| Library | discord.js **v14** |
| Time | [luxon](https://moment.github.io/luxon/) — event schedules are timezone-aware and DST-safe |
| Config / secrets | `.env` via `dotenv` |
| Logging | [pino](https://getpino.io) (+ `pino-pretty` in dev) |
| Content persistence | flat authored JSON on disk (validated content store), per-guild config JSON under `data/config/` |
| Stash persistence | **Postgres on Supabase** (`pg`) — the mutable, durable inventory + requests + donor ledger |
| Scheduling | a single `setInterval` "tick" (default 60 s) drives timers + stash upkeep — no external cron |
| Process manager | **pm2** (`ecosystem.config.cjs`), single fork instance |

**Intents:** `Guilds` + `GuildMembers`. `GuildMembers` is **privileged** and must be enabled
in the Discord Developer Portal — it's required so `role.members` is populated for the DM
fan-out. Without it, role-holder DMs silently reach nobody.

**Durability note:** the content store and per-guild config are flat files under `data/`; the
Community Stash's *inventory* is off-disk in Postgres, but its *wiring* (the `stash` config
block) still lives in `data/` config. A future Heroku migration would need to move that mutable
`data/` state to a durable store first (see `CLAUDE.md`).

---

## Getting started

### Prerequisites

- Node.js ≥ 20
- A Discord application + bot ([Discord Developer Portal](https://discord.com/developers/applications))
  with the **Server Members Intent** enabled under *Bot → Privileged Gateway Intents*.
- *(Optional, for the Community Stash)* a Postgres database (Supabase) reachable via
  `DATABASE_URL`. Absent or unreachable ⇒ the stash disables gracefully; everything else runs.

### 1. Install

```bash
npm install
```

### 2. Configure

Copy the example env file and fill it in (`.env` is gitignored):

```bash
cp .env.example .env
```

```dotenv
# Discord application credentials
DISCORD_TOKEN=              # Bot token
DISCORD_APP_ID=             # Application (client) ID

# Guilds to register slash commands to (comma-separated, e.g. test,prod).
# Per-guild registration is instant; global registration is not supported.
DISCORD_GUILD_IDS=

# Admin gate: role IDs allowed to run admin/dev commands (comma-separated).
# When set, the weak name-based "dev" fallback is disabled.
DISCORD_ADMIN_ROLE_IDS=

# Community Stash storage (optional). Absent => stash disabled, bot still runs.
DATABASE_URL=

# Log level: trace | debug | info | warn | error
LOG_LEVEL=info
```

`src/config/env.js` validates required vars on import and **fails fast** with a clear message
if `DISCORD_TOKEN` or `DISCORD_APP_ID` is missing — so `npm start` / `npm run deploy` error up
front rather than deep inside the client.

### 3. Register slash commands

```bash
npm run deploy
```

- Commands register to every guild in `DISCORD_GUILD_IDS` **instantly**.
- Global registration is intentionally disabled; if `DISCORD_GUILD_IDS` is blank the deploy
  aborts with an error rather than registering globally.

Re-run this **only when a command's signature changes** — the bot does **not** re-register on
every boot. Presentational/content changes never need a redeploy.

### 4. Run

```bash
npm start
```

On boot the bot logs the loaded commands, comes online, and starts the 60 s tick loop.

Under pm2 (how it runs in production):

```bash
pm2 start ecosystem.config.cjs   # start/adopt the bot as app "twinkhub"
pm2 reload twinkhub              # zero-downtime restart after a code change
pm2 logs twinkhub                # tail logs
pm2 save                         # snapshot the process list for boot resurrect
```

### Scripts

| Script | Command | Purpose |
|---|---|---|
| `npm start` | `node src/index.js` | Run the bot |
| `npm run deploy` | `node src/deploy-commands.js` | Register slash commands with Discord |
| `npm test` | `node --test` | Unit tests (`test/`) — secretless |
| `npm run test:int` | `node --test test/integration/` | DB-backed integration tests (needs `DATABASE_URL`) |
| `npm run lint` | `eslint .` | Lint |
| `npm run format:check` | `prettier --check .` | Formatting gate |
| `npm run stash:consolidate` | `node scripts/consolidate-stash.js` | Merge duplicate stash item groups |

---

## Project structure

```
TwinkHub/
├── .env.example                 env template
├── ecosystem.config.cjs         pm2 process definition (app "twinkhub")
├── package.json
├── plans/                       authoritative spec (00–16)
├── supabase/
│   └── migrations/              stash schema; applied via Supabase CLI, never at boot
├── src/
│   ├── index.js                 client bootstrap, intents, login, tick loop, component router
│   ├── deploy-commands.js       register slash commands with Discord
│   ├── config/
│   │   ├── env.js               load + validate env (fail-fast)
│   │   └── guildConfig.js       per-guild JSON I/O (load/save/merge; timers/board/panels/stash)
│   ├── storage/                 atomic keyed JSON store + per-key locks
│   ├── lib/
│   │   ├── logger.js            pino (pretty in dev)
│   │   ├── access.js            requireAdmin / requireManager / requireRequester gates
│   │   ├── time.js              zone-aware countdown fmt, edge/latch helpers
│   │   └── delivery.js          ping / broadcast / dm fan-out
│   ├── commands/                auto-loaded; one file per command
│   │   ├── misc/ping.js
│   │   ├── admin/               setup, alerts, timerdms, timerboard, panels, reloadcontent, stashadmin
│   │   ├── data/                bis, gear, item, enchant, consumable, class, tierlist, quest,
│   │   │                        guide, optimize, xprules, statweights, pets, talents, spellcoef, stash
│   │   └── timers/              events, nextevent, testevent
│   ├── services/                render layer: renderBis/... -> { embeds, components }
│   ├── components/              button/select handlers + customId routers (p1| content, s1| stash)
│   ├── timers/
│   │   ├── engine.js            tick(): compute states, edge-detect, deliver
│   │   ├── stash.js             per-tick stash panel refresh + stale-approval sweep
│   │   └── events/              bg / agm / dmf / stv — getState(now) + policy
│   ├── content/
│   │   ├── store.js             load + index bracket/class-namespaced JSON
│   │   └── schema.js            schemas; validate on boot
│   └── stash/
│       ├── store.js             THE ONLY module that touches stash SQL (lazy, optional pool)
│       └── notify.js            best-effort manager pings + requester DMs
├── data/
│   ├── config/                  <guildId>.json (runtime, per-guild — gitignored)
│   └── content/                 authored knowledge, bracket-namespaced (19/ …)
└── logs/                        twinkhub.log
```

### How commands load

`src/commands/index.js` recursively walks `src/commands/`, imports every `.js` module that
exports both `data` (a `SlashCommandBuilder`) and an `execute(interaction)` function, and keys
them into a `Collection` by command name. Adding a command = drop a file in — no central
registry to edit.

---

## Configuration model (per-guild)

Runtime config lives at `data/config/<guildId>.json` (gitignored). It's merged over
`DEFAULT_CONFIG` on read, so new keys are backfilled automatically:

```json
{
  "alertChannelId": null,
  "alertRoleId": null,
  "dmEnabled": true,
  "activeBrackets": ["19"],
  "timers": { "bg": true, "agm": true, "dmf": true, "stv": true },
  "timerBoard": null,
  "panels": null,
  "stash": null
}
```

- `dmEnabled` — per-guild DM fan-out toggle, **defaults true**, preserved across re-`/setup`.
- `activeBrackets` — which content namespaces the data commands expose (default `["19"]`).
- `timers.<event>` — disable individual event alerts per guild.
- `timerBoard` — `{ channelId, messageId }` for the persistent auto-updating dashboard message;
  `null` until set. Its channel is **independent** of the alert channel.
- `panels` — `{ channelId, messageIds{...} }` for the interactive content panels; `null` until
  posted.
- `stash` — the Community Stash wiring; `null` until configured. Holds **only** role/channel
  wiring and tunables (the inventory itself lives in Postgres):
  `{ channelId, managerPanelChannelId, panelMessageIds: { browse, manager }, requesterRoleIds,
  managerRoleIds, managerChannelId, requestCap, staleApprovalDays }`. Merged with a functional
  patch so panel posts and role edits never clobber each other's fields.

---

## Access control

Three tiers, strongest first:

- **Admin / dev** (`requireAdmin`) — gates the timer/panel admin commands. Passes for **Manage
  Server**, or any role ID in `DISCORD_ADMIN_ROLE_IDS`. A legacy name-based `dev` role is a
  fallback **only** when no admin role IDs are configured (weak — disabled the moment real IDs
  are set).
- **Stash Manager** (`requireManager`) — gates `/stashadmin` actions. Passes for **Manage Server**
  or a role in the guild's `stash.managerRoleIds`. The `roles`/`config` subgroups additionally
  require Manage Server.
- **Stash Requester** (`requireRequester`) — gates *requesting* items. Passes for Managers or a
  role in `stash.requesterRoleIds` (the Twink role). Browsing the stash is open to everyone.

Enduser data and timer read commands (`/bis`, `/events`, etc.) are **open to everyone**.

---

## Command surface

### Enduser — data / knowledge

| Command | Returns |
|---|---|
| `/bis` | Best-in-slot list for a class (the flagship command). |
| `/gear` | Filterable gear entries (core / situational / budget, faction). |
| `/item` | A single item's stats, source, faction, notes, Wowhead link. |
| `/enchant` | Enchants for a slot/class; **flags no-level-requirement** ones. |
| `/consumable` | Recommended consumables by type (potion/poison/food/explosive/worldbuff). |
| `/class` | Class overview: tier, roles, stat priority, spec + faction notes. |
| `/tierlist` | The bracket's class tier ranking with one-line rationales. |
| `/quest` | Gear-reward quests worth doing pre-cap; **flags XP-risk turn-ins**. |
| `/guide` | Curated long-form guide, paginated. |
| `/optimize` | Gap checklist: missing a core slot / enchant / consumable / profession? |
| `/xprules` | XP management for the bracket (e.g. **19: no XP-off toggle in Classic Era**). |
| `/statweights` | Stat conversions/priority for a class (STR→AP, AGI→crit/dodge, STA→HP, hit caps). |
| `/pets` | Hunter pet recommendations: families/abilities, tame levels/zones, pet-XP note. |
| `/talents` | Recommended talent builds for a class/spec. |
| `/spellcoef` | Spell coefficient reference. |

### Enduser — events

| Command | Returns |
|---|---|
| `/events` | Dashboard of all tracked events (with icons), next-fire countdowns, sorted by urgency. |
| `/nextevent` | The single soonest-firing event. |

### Community Stash

| Command | Access | Effect |
|---|---|---|
| `/stash` | requester (browse open) | List / request / view mine / cancel donated items. |
| `/stashadmin` | manager | add / list / queue / approve / sent / deny / remove, plus `panel` / `roles` / `config` groups. |

### Admin

| Command | Access | Effect |
|---|---|---|
| `/setup` | admin | Set the guild's alert channel + role. Preserves existing `dmEnabled`. |
| `/alerts` | admin | Per-event alert toggle for this guild. |
| `/timerdms` | admin | Per-guild DM fan-out toggle (server-wide). |
| `/timerboard` | admin | Create/move/tear down the persistent auto-updating timer board. |
| `/panels` | admin | Post / refresh / remove the interactive content panels. |
| `/reloadcontent` | admin | Re-read the content store without a restart, for authoring. |
| `/testevent` | admin | Fire an event message on demand. |
| `/ping` | admin | Gateway-latency health check (ephemeral). |

Full detail: `plans/04-commands.md`.

---

## Timers module

A consolidated port of the four event-timer bots into one subsystem. All schedules are
timezone-aware and DST-safe.

| Event | Schedule | Advance ping | Occurrence | Delivery |
|---|---|---|---|---|
| **BG Weekend** | Thu 2am → Tue 2am; rotates **AV → EOTS → WSG → AB** | none | **pings** on go-live | occurrence-ping |
| **Arena Grand Master (AGM)** | every 3h from midnight, 5-min window | **10-min** | silent post | advance-ping + silent |
| **Darkmoon Faire (DMF)** | first full week each month, Mon 00:01 | none | **pings** on open | occurrence-ping |
| **STV Fishing** | Sundays 2–4pm | **30-min** | silent post | advance-ping + silent |

Key design points:

- **Pure, `now`-injectable `getState(now)` functions** per event (unit-testable). BG rotation
  anchors on a confirmed AV week.
- **Edge detection + advance-warning latches** — fire the occurrence only on the false→true
  transition; fire the advance ping once and re-arm only after the window clearly passes.
  Persisted so a restart mid-window doesn't double-ping.
- **Three delivery modes:** `ping` (mention the alert role), `broadcast` (silent, all mentions
  suppressed), `dm` (fan out to role-holders, respecting `dmEnabled`).
- **One asymmetry preserved:** AGM's spawn is both silent **and** DM-free; only its 10-min
  warning DMs.
- **Persistent timer board:** a single bot-owned message the tick **edits in place every 60 s**
  with live countdowns — a self-refreshing dashboard, always silent, self-healing if deleted.
  (`/events` renders with the content store so it shows event icons; the board renders without
  it.)

See `plans/02-timers-module.md`.

---

## Content / data model

Content is **authored data, not code**. It's split by **bracket → domain → class** so files
stay small, diff-friendly, and expandable:

```
data/content/
├── index.json              # registry: brackets present, schema version
└── 19/                     # bracket namespace (same internal shape for every bracket)
    ├── meta.json           # bracket rules: cap, XP rules, WSG info, gameVersion
    ├── classes/            # per-class: tier, specs, stat priority, notes
    ├── gear/               # BiS by slot, per class (+ faction variants)
    ├── enchants.json       # no-level-req flagged (the cornerstone twink mechanic)
    ├── consumables.json    # potions, poisons, food, explosives, world buffs
    ├── quests.json         # gear-reward quests (XP-risk flagged)
    ├── scaling.json        # stat conversion constants + per-class overrides
    ├── pets.json           # hunter pet families/abilities
    ├── sets.json           # curated set links
    └── guides/             # long-form curated guides
```

`content/store.js` walks the tree, validates every file against `content/schema.js` **on boot**,
and builds in-memory indexes (by bracket, class, slot, item name for autocomplete). Fail loud on
invalid content in dev; in prod, skip the bad file, log it, and keep serving the rest — never
crash the bot over one malformed guide.

Authoring rules, schemas, and validation gates: `plans/03-data-model.md`. The verified 19-twink
domain facts seeding the store live in `plans/05-19-twink-domain.md`. Bracket expansion:
`plans/06-bracket-expansion.md`.

---

## Interactive enduser panels

A click-driven alternative to the slash commands: a read-only channel holds persistent bot-owned
embeds ("panels") with buttons/select menus. Clicking returns an **ephemeral** result produced by
the **same render function** the equivalent slash command uses.

- **Why they persist forever:** message components aren't registered like slash commands — a
  button just fires `interactionCreate` carrying its `customId`. As long as the running bot's
  router recognizes that `customId`, the control works indefinitely and across restarts, with
  **no server-side session state**. Post once; works forever.
- **`customId` contract:** `p1|<action>|<arg?>` for content panels (pipe-delimited, ≤100 chars,
  **versioned**); the Community Stash panel uses a separate `s1|<action>|<arg>` namespace, forked
  in `index.js` to `src/components/stash.js`.
- **Shared service layer:** both slash `execute()` and panel handlers call the same
  `renderBis({...}) -> { embeds, components }` functions and differ only in the `flags` they
  attach — so the two front-ends never drift.

See `plans/08-enduser-panels.md`.

---

## Community Stash

A donated-item giveaway system: **intake → browse → request → approve → hand-off**. Unlike the
read-only content store, this is **mutable, transactional, durable** state, so it lives in
**Postgres on Supabase**, not `data/`. Full design + as-built notes in `plans/14-community-stash.md`.

- **Storage seam:** `src/stash/store.js` is the **ONLY** module that touches SQL. It's reached by
  `DATABASE_URL`; the pool connects **lazily** and the key is **optional** — absent/unreachable ⇒
  `store.isEnabled()` is false and the stash disables gracefully while timers/panels/reference
  commands keep running. The bot never `await`s a DB connect at boot.
- **Migrations:** schema lives in `supabase/migrations/`, applied via the **Supabase CLI**
  (`db push`) as a deliberate deploy step — **never by the bot at boot**.
- **Two front-ends:** a public **browse panel** (`s1|` customIds) anyone can read, plus a
  **manager console** for the intake/approval workflow.
- **Dedup:** adds and consolidation are guarded by a partial-unique index on
  `(guild_id, wowhead_id)` over active rows, so the same item stacks into one group instead of
  fragmenting. `npm run stash:consolidate` merges any pre-existing duplicates.
- **Top Donors leaderboard:** a lifetime ranking backed by an **append-only** `stash_donations`
  ledger (aggregated on a generated `donor_key`). Consolidation writes nothing to the ledger, so
  it can't corrupt lifetime counts. Donors are stored as `<@id>` mentions — a stable identity that
  groups cleanly (Discord renders the member's name).
- **Access:** browsing is open; requesting gates on `stash.requesterRoleIds` (the Twink role);
  Manager actions gate on Manage Server OR `stash.managerRoleIds`. All wiring is per-guild under
  the `stash` config block, never in code.
- **Notifications** (`src/stash/notify.js`): best-effort, fire-and-forget — a manager-channel ping
  on new requests (opt-in via `managerChannelId`) and requester DMs on approve/sent/deny/expiry.
  A notify failure never blocks the triggering action.
- **Tick work** (`src/timers/stash.js`): refreshes the panel + sweeps stale approvals on the
  existing 60 s tick, throttled by a per-guild fingerprint (only edits on real change).

---

## Roadmap

The original P0–P6 build phases have shipped through the panel layer; bracket expansion and the
production cutover of legacy timers are the remaining scheduled work. The **Community Stash** was
added as a third pillar beyond the original plan.

| Phase | Scope | Status |
|---|---|---|
| **P0** | Scaffold: client, intents, env/logger, tick, `/setup`, `/ping`, access gate | ✅ shipped |
| **P1** | Timers: 4 `getState` fns, 3 delivery modes, edge/latch, `/events`+`/nextevent`+admin, board | ✅ shipped |
| **P2** | Content store + schema; seed `19/`; core data commands with autocomplete | ✅ shipped |
| **P3** | `/gear` `/consumable` `/quest` `/guide` `/optimize` + `/reloadcontent`; `/talents` `/spellcoef` | ✅ shipped |
| **P4** | Interactive panels: component router, shared service layer, panel catalogue, `/panels` | ✅ shipped |
| **+** | **Community Stash** — Postgres-backed giveaway system, panels, Top Donors ledger | ✅ shipped |
| **P5** | Bracket expansion: add `29/` then `49/`; `/brackets` toggle | planned |
| **P6** | Cutover: point production alerts at TwinkHub; retire the legacy Python timer bots | planned |

Full detail: `plans/07-roadmap.md`.

---

## Relationship to sibling projects

| Project | What it is | Relationship |
|---|---|---|
| **`wow-timers`** (Python, 4 bots) | The existing event-timer bots | TwinkHub **ports + consolidates** their event logic. `wow-timers` keeps running until TwinkHub's timer module is proven in production, then it's retired. |
| **`WSG-Queue-Tracker`** (planning) | Bot + WeakAura tracking WSG queue pop / game start-end | **Sibling, not merged.** Its live-queue telemetry could later surface here as a command, but stays separate for now. |

---

## Design principles

- **Thin command handlers, fat data** — no game knowledge hardcoded; commands read a modular,
  validated content store. New BiS item = a data edit, not a code change.
- **Bracket- and class-namespaced content** so expansion is additive; nothing hard-assumes "19".
- **Shared service/render layer** — data commands are written against `services/`, so panel
  buttons reuse them verbatim.
- **Single SQL seam** — all mutable stash state goes through `src/stash/store.js`; nothing else
  touches the database, and it degrades gracefully when unconfigured.
- **Migrations are a deploy step, never a boot step** — the bot never mutates schema on startup.
- **Portable, ID-first access control** for admin commands; per-guild config for stash roles.
- **Everything server-configurable per guild** (channel, alert role, active brackets, DM opt-in,
  stash wiring), defaulting sanely.
- **Don't re-register slash commands every boot** (avoids "command outdated" cache thrash).
- **Schema-validate content on boot** — fail loud in dev, degrade gracefully in prod.

---

## Documentation map

The [`plans/`](plans/) folder is the authoritative spec.

| File | Purpose |
|---|---|
| `00-overview.md` | Vision, scope, non-goals. |
| `01-architecture.md` | discord.js structure, project tree, persistence, deploy. |
| `02-timers-module.md` | Consolidated event-timer subsystem. |
| `03-data-model.md` | Modular content store: schema, namespacing, authoring. |
| `04-commands.md` | Full slash-command surface (data + timers + admin). |
| `05-19-twink-domain.md` | Domain research grounding the 19 content (verified facts). |
| `06-bracket-expansion.md` | Scaling 19 → 29 / 49 / beyond. |
| `07-roadmap.md` | Phased build plan and milestones. |
| `08-enduser-panels.md` | Interactive button/select panel surface. |
| `09-bis-reference.md` | BiS reference research. |
| `10-embed-formatting-review.md` | Embed presentation review. |
| `11-bis-alliance-faction-audit.md` | Faction-parity audit of BiS data. |
| `12-talent-builds.md` | Talent-build content design. |
| `13-hardening-review.md` | Security / robustness hardening pass. |
| `14-community-stash.md` | Community Stash design + as-built notes. |
| `15-stash-manage-item-slot-nav.md` | Stash manager item/slot navigation. |
| `16-stash-top-donors.md` | Top Donors ledger + leaderboard. |
