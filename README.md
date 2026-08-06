<p align="center">
  <img src="assets/banner.jpg" alt="TwinkHub" width="100%">
</p>

# TwinkHub

A single, generalized **Discord bot for the WoW Classic Era twinking community** — starting
with the **10–19 Warsong Gulch (WSG)** bracket. Built on [discord.js](https://discord.js.org)
v14 (Node.js, ES modules).

TwinkHub folds two capability pillars into one bot:

1. **Data / knowledge commands** *(the main event)* — a wide surface of enduser slash
   commands answering "what gear / enchant / consumable / quest / spec should I use," plus
   curated guides and an optimization ("did you forget X?") pass. All game knowledge lives in
   a **modular, validated content store** (authored JSON) — adding a BiS item is a data edit,
   never a code change.
2. **Event timers** — a consolidated, improved re-implementation of the recurring in-game
   event logic currently split across the four `wow-timers` Python bots (BG Weekend, Arena
   Grand Master, Darkmoon Faire, STV Fishing), folded into this one process.

Both pillars are reachable two ways: **slash commands** (primary, with autocomplete) and — for
the common enduser reads — **interactive panels** (persistent bot-owned embeds with
buttons/select menus that return ephemeral results through the same render logic).

---

## Project status

> **Phase P0 (Scaffold) is implemented.** The timer engine, content store, and data commands
> are specified in `plans/` but **not yet built**. See [Roadmap](#roadmap).

**What works today (P0):**

- Bot boots, logs in, loads slash commands, and runs a 60 s tick-loop skeleton (the timer
  engine hooks in here at P1 — currently a no-op).
- `/setup` (dev-gated) persists a guild's alert channel + role to `data/config/<guildId>.json`.
- `/ping` (dev-gated) health check replying with gateway latency.
- Name-based **dev-role** access control with clean ephemeral rejection for non-dev users.
- Per-guild JSON config with sane defaults, auto-backfilled on read.
- `deploy-commands.js` registration flow (guild-scoped for instant dev iteration, or global).

**What's planned (P1→P6):** the timers module, the `data/content/` store + schema validation,
the full data-command surface, interactive panels, and bracket expansion (29/49). Every one of
these is fully spec'd under [`plans/`](#documentation-map).

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
  fresh progression realms (that's the sibling `wow-timers` project's world), or TBC and beyond.

The target is encoded in data as `meta.json.gameVersion` per bracket so it's machine-checkable,
not just prose. See `plans/05-19-twink-domain.md` §"Game version target".

---

## Tech stack

| Concern | Choice |
|---|---|
| Runtime | Node.js **≥ 20** (LTS), ES modules (`"type": "module"`) |
| Library | discord.js **v14** |
| Time | [luxon](https://moment.github.io/luxon/) — all event schedules computed in `America/Denver` (Mountain), DST-safe |
| Config / secrets | `.env` via `dotenv` |
| Logging | [pino](https://getpino.io) (+ `pino-pretty` in dev) |
| Persistence (v1) | flat JSON on disk (per-guild config + content store); a DB is a later option once write-features arrive |
| Scheduling | a single `setInterval` "tick" (default 60 s) drives the timer module — no external cron |

**Intents:** `Guilds` + `GuildMembers`. `GuildMembers` is **privileged** and must be enabled
in the Discord Developer Portal — it's required so `role.members` is populated for the DM
fan-out (planned at P1). Without it, role-holder DMs silently reach nobody.

---

## Getting started

### Prerequisites

- Node.js ≥ 20
- A Discord application + bot ([Discord Developer Portal](https://discord.com/developers/applications))
  with the **Server Members Intent** enabled under *Bot → Privileged Gateway Intents*.

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
DISCORD_TOKEN=          # Bot token
DISCORD_APP_ID=         # Application (client) ID

# Guilds to register slash commands to (comma-separated, e.g. test,prod).
# Per-guild registration is instant; global registration is not supported.
DISCORD_GUILD_IDS=

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
every boot (this deliberately avoids the "This command is outdated" cache thrash the
`wow-timers` bots trigger by syncing on every startup).

### 4. Run

```bash
npm start
```

On boot the bot logs the loaded commands, comes online, and starts the 60 s tick loop.

### Scripts

| Script | Command | Purpose |
|---|---|---|
| `npm start` | `node src/index.js` | Run the bot |
| `npm run deploy` | `node src/deploy-commands.js` | Register slash commands with Discord |

---

## Project structure

Implemented files are marked ✅; the rest is scaffolded per the architecture spec and lands
along the roadmap.

```
TwinkHub/
├── .env.example                 ✅ env template
├── package.json                 ✅
├── plans/                       ✅ authoritative spec (00–08)
├── src/
│   ├── index.js                 ✅ client bootstrap, intents, login, tick-loop skeleton
│   ├── deploy-commands.js       ✅ register slash commands with Discord
│   ├── config/
│   │   ├── env.js               ✅ load + validate env (fail-fast)
│   │   └── guildConfig.js       ✅ per-guild JSON I/O (load/save/set flags)
│   ├── lib/
│   │   ├── logger.js            ✅ pino (pretty in dev)
│   │   ├── access.js            ✅ requireDevRole() — name-based gate
│   │   ├── time.js                 (P1) MT zone, countdown fmt, edge/latch helpers
│   │   └── delivery.js             (P1) ping / broadcast / dm fan-out
│   ├── commands/                ✅ auto-loaded; one file per command
│   │   ├── misc/ping.js         ✅ dev-gated health check
│   │   ├── admin/setup.js       ✅ set alert channel + role
│   │   ├── data/                   (P2/P3) /bis /gear /enchant /class ...
│   │   └── timers/                 (P1) /events /nextevent /testevent ...
│   ├── services/                   (P2) render layer: renderBis/... -> { embeds, components }
│   ├── components/                 (P4) button/select handlers + customId router
│   ├── timers/
│   │   ├── engine.js               (P1) tick(): compute states, edge-detect, deliver
│   │   └── events/                 (P1) bg / agm / dmf / stv — getState(now) + policy
│   └── content/
│       ├── store.js                (P2) load + index bracket/class-namespaced JSON
│       └── schema.js               (P2) zod/ajv schemas; validate on boot
├── data/
│   ├── config/                  ✅ <guildId>.json (runtime, per-guild — gitignored)
│   └── content/                    (P2) authored knowledge, bracket-namespaced (19/ 29/ …)
└── logs/                           (P1) twinkhub.log
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
  "panels": null
}
```

- `dmEnabled` — per-guild DM fan-out toggle, **defaults true**, preserved across re-`/setup`.
- `activeBrackets` — which content namespaces the data commands expose (default `["19"]`).
- `timers.<event>` — disable individual event alerts per guild.
- `timerBoard` *(P1)* — `{ channelId, messageId }` for the persistent auto-updating dashboard
  message; `null` until set. Its channel is **independent** of the alert channel.
- `panels` *(P4)* — `{ channelId, messageIds{...} }` for the interactive enduser panels;
  `null` until posted. Independent of the alert/board channels.

---

## Access control

Admin/dev commands are gated by a role **named** `dev` (case-insensitive, matched **by name,
not ID** → portable across servers). This ports `require_dev_role()` from `wow-timers`.

```js
if (!(await requireDevRole(interaction))) return;
```

Non-dev callers get a clean ephemeral "you need the **dev** role" reply. Enduser data commands
(planned) are **open to everyone**; only `admin/` and `timers/` test commands are dev-gated.

---

## Command surface

### Implemented (P0)

| Command | Access | Effect |
|---|---|---|
| `/ping` | dev | Gateway-latency health check (ephemeral). |
| `/setup` | dev | Set the guild's alert channel + role. Preserves existing `dmEnabled`. |

### Planned — enduser data / knowledge (P2/P3)

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
| `/optimize` | Gap checklist: are you missing a core slot / enchant / consumable / profession? |
| `/xprules` | XP management for the bracket (e.g. **19: no XP-off toggle in Classic Era**). |
| `/statweights` | Stat conversions/priority for a class (STR→AP, AGI→crit/dodge, STA→HP, hit caps). |
| `/pets` | Hunter pet recommendations: families/abilities, tame levels/zones, pet-XP note. |

### Planned — enduser events / admin (P1+)

| Command | Access | Effect |
|---|---|---|
| `/events` | all | Dashboard of all tracked events, next-fire countdowns, sorted by urgency. |
| `/nextevent` | all | The single soonest-firing event. |
| `/alerts` | dev | Per-event alert toggle for this guild. |
| `/timerdms` | dev | Per-guild DM fan-out toggle. |
| `/timerboard` | dev | Create/move/tear down the persistent auto-updating timer board. |
| `/brackets` | dev | Enable/disable a content bracket for this guild. |
| `/panels` | dev | Post / refresh / remove the interactive enduser panels. |
| `/testevent` | dev | Fire an event message on demand (mirrors `wow-timers` test semantics). |
| `/reloadcontent` | dev | (Later) Re-read the content store without a restart, for authoring. |

Full detail: `plans/04-commands.md`.

---

## Timers module (planned, P1)

A consolidated port of the four `wow-timers` Python bots into one subsystem. All schedules are
Mountain Time (`America/Denver`), DST-safe.

| Event | Schedule | Advance ping | Occurrence | Delivery |
|---|---|---|---|---|
| **BG Weekend** | Thu 2am → Tue 2am; rotates **AV → EOTS → WSG → AB** | none | **pings** on go-live | occurrence-ping |
| **Arena Grand Master (AGM)** | every 3h from midnight, 5-min window | **10-min** | silent post | advance-ping + silent |
| **Darkmoon Faire (DMF)** | first full week each month, Mon 00:01 | none | **pings** on open | occurrence-ping |
| **STV Fishing** | Sundays 2–4pm | **30-min** | silent post | advance-ping + silent |

Key design points carried over verbatim from the Python source:

- **Pure, `now`-injectable `getState(now)` functions** per event (unit-testable exactly like
  the Python versions). BG rotation anchors on `2026-03-24 08:00 UTC` (a confirmed AV week).
- **Edge detection + advance-warning latches** — fire the occurrence only on the false→true
  transition; fire the advance ping once and re-arm only after the window clearly passes.
  Persisted so a restart mid-window doesn't double-ping.
- **Three delivery modes:** `ping` (mention the alert role), `broadcast` (silent, all mentions
  suppressed), `dm` (fan out to role-holders, respecting `dmEnabled`).
- **One asymmetry preserved:** AGM's spawn is both silent **and** DM-free; only its 10-min
  warning DMs.
- **Persistent timer board:** a single bot-owned message the tick **edits in place every 60 s**
  with live countdowns — a self-refreshing dashboard, always silent, self-healing if deleted.

**Dropped** in consolidation (single identity → no per-event theatrics): per-event avatar
swapping, the ①②③④ nickname prefixes, and per-event presence strings.

See `plans/02-timers-module.md`. Migration rule: run TwinkHub's timers **alongside**
`wow-timers` on a **separate** test channel/role for a full cycle of each event before cutover
— **never** both against the same channel/role (that double-pings).

---

## Content / data model (planned, P2)

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
    ├── sets.json           # curated Sixty Upgrades set links
    └── guides/             # long-form curated guides
```

`content/store.js` walks the tree, validates every file against `content/schema.js` (zod/ajv)
**on boot**, and builds in-memory indexes (by bracket, class, slot, item name for
autocomplete). Fail loud on invalid content in dev; in prod, skip the bad file, log it, and
keep serving the rest — never crash the bot over one malformed guide.

Authoring rules, schemas, and validation gates: `plans/03-data-model.md`. The verified 19-twink
domain facts seeding the store live in `plans/05-19-twink-domain.md`. Bracket expansion:
`plans/06-bracket-expansion.md`.

---

## Interactive enduser panels (planned, P4)

A click-driven alternative to the slash commands: a read-only channel holds persistent
bot-owned embeds ("panels") with buttons/select menus. Clicking returns an **ephemeral** result
produced by the **same render function** the equivalent slash command uses.

- **Why they persist forever:** message components aren't registered like slash commands — a
  button just fires `interactionCreate` carrying its `customId`. As long as the running bot's
  router recognizes that `customId`, the control works indefinitely and across restarts, with
  **no server-side session state**. Post once; works forever.
- **`customId` contract:** `p1|<action>|<arg?>` — pipe-delimited, ≤100 chars, **versioned**
  (the `p1` prefix lets the router detect stale buttons after an encoding change).
- **Shared service layer (non-negotiable):** both slash `execute()` and panel handlers call the
  same `renderBis({...}) -> { embeds, components }` functions and differ only in the `flags`
  they attach — so the two front-ends never drift. P2/P3 commands are written against this
  layer from day one.

See `plans/08-enduser-panels.md`.

---

## Roadmap

Each phase is shippable on its own.

| Phase | Scope | Exit criteria |
|---|---|---|
| **P0** ✅ | Scaffold: client, intents, env/logger, tick skeleton, `/setup`, `/ping`, dev-role gate | Bot logs in, `/setup` persists, dev-gated `/ping` responds, non-dev cleanly rejected |
| **P1** | Timers module: 4 `getState` fns (unit-tested), 3 delivery modes, edge/latch, `/events`+`/nextevent`+admin, persistent board | Runs **alongside** `wow-timers` and matches every event's timing + ping/DM for one full cycle |
| **P2** | Content store + schema; seed `19/`; `/bis` `/class` `/tierlist` `/enchant` `/item` `/xprules` with autocomplete | A WSG-19 player gets accurate BiS/enchant/XP answers; adding items needs no code |
| **P3** | `/gear` `/consumable` `/quest` `/guide` (paginated) `/optimize`; `/reloadcontent`; CI content validation | `/optimize` returns useful "missing X" for every 19 class |
| **P4** | Interactive panels: component router + registry, shared service layer, panel catalogue, `/panels` | Users click through to accurate ephemeral results; controls survive a restart |
| **P5** | Bracket expansion: add `29/` then `49/`; `/brackets` toggle | A second bracket is fully served with **no** code changes beyond data |
| **P6** | Cutover: point production alerts at TwinkHub; retire the four Python bots | Production runs on TwinkHub; `wow-timers` decommissioned |

**Backlog (unscheduled):** per-user loadout saving (`/myset` → revisit DB), optional
`WSG-Queue-Tracker` integration, a web content-authoring UI, item-icon embed polish.

Full detail: `plans/07-roadmap.md`.

---

## Relationship to sibling projects

| Project | What it is | Relationship |
|---|---|---|
| **`wow-timers`** (Python, 4 bots) | The existing event-timer bots | TwinkHub **ports + consolidates** their event logic. `wow-timers` keeps running until TwinkHub's timer module is proven, then it's retired. |
| **`WSG-Queue-Tracker`** (planning) | Bot + WeakAura tracking WSG queue pop / game start-end | **Sibling, not merged.** Its live-queue telemetry could later surface here as a command, but stays separate for now. |

---

## Design principles

- **Thin command handlers, fat data** — no game knowledge hardcoded; commands read a modular,
  validated content store. New BiS item = a data edit, not a code change.
- **Bracket- and class-namespaced content** so expansion is additive; nothing hard-assumes "19".
- **Shared service/render layer** — write data commands against `services/` (not inline in
  `execute()`) from P2, so P4 panel buttons reuse them verbatim.
- **Portable, name-based access control** for dev/admin commands.
- **Everything server-configurable per guild** (channel, alert role, active brackets, DM
  opt-in), stored as per-guild JSON, defaulting sanely.
- **Don't re-register slash commands every boot** (avoids "command outdated" cache thrash).
- **Schema-validate content on boot** — fail loud in dev, degrade gracefully in prod.

---

## Documentation map

The [`plans/`](plans/) folder is the authoritative spec.

| File | Purpose |
|---|---|
| `00-overview.md` | Vision, scope, non-goals. |
| `01-architecture.md` | discord.js structure, project tree, persistence, deploy. |
| `02-timers-module.md` | Consolidated event-timer subsystem (port of the 4 bots). |
| `03-data-model.md` | Modular content store: schema, namespacing, authoring. |
| `04-commands.md` | Full slash-command surface (data + timers + admin). |
| `05-19-twink-domain.md` | Domain research grounding the 19 content (verified facts). |
| `06-bracket-expansion.md` | Scaling 19 → 29 / 49 / beyond. |
| `07-roadmap.md` | Phased build plan and milestones. |
| `08-enduser-panels.md` | Interactive button/select panel surface. |
