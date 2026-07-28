# Roadmap

Phased build plan. Each phase is shippable on its own. Nothing here is built yet.

## P0 — Scaffold (foundations)
- Initialize discord.js v14 app: `src/index.js`, intents (Guilds + **GuildMembers**),
  login, config/env loading, logger, 60s tick loop skeleton.
- `deploy-commands.js` registration flow (guild-scoped for the test server).
- Per-guild config I/O (`data/config/<guildId>.json`) with `/setup`.
- Access control: `requireDevRole` + ephemeral error handler.
- **Exit criteria:** bot logs in, `/setup` persists channel+role, a dev-gated `/ping`
  responds, non-dev is cleanly rejected.

## P1 — Timers module (parity with wow-timers)
- Port the four `getState` functions (BG anchor / AGM / DMF / STV) with unit tests using
  injected `now` (verify against the Python outputs).
- Implement the three delivery modes (ping / broadcast / dm) and the per-event policy table.
- Edge detection + advance-warning latches (persisted, restart-safe, no double-ping).
- Commands: `/events`, `/nextevent`, `/alerts`, `/timerdms`, `/testevent`.
- Drop per-event avatar/nickname/presence machinery (single identity).
- **Exit criteria:** run **alongside** `wow-timers` on a separate test channel/role; match
  every event's fire timing + ping/DM behavior for one full cycle each (AGM fast, STV
  weekly, DMF monthly). Then it's ready to replace the Python bots.

## P2 — Static data commands (19 read surface)
- Stand up the content store + schema validation over `data/content/19/`.
- Seed `19/` from `05-19-twink-domain.md` (meta, class tiers, core gear, enchants,
  consumables, key quests, a few guides). Start with 2–3 flagship classes (Hunter, Rogue,
  Warrior), then fill the rest.
- Commands: `/bis`, `/class`, `/tierlist`, `/enchant`, `/item`, `/xprules`, with
  autocomplete.
- **Exit criteria:** a WSG-19 player can get accurate BiS + enchant + XP-rules answers for
  the seeded classes with zero code changes to add more items.

## P3 — Rich data + optimization
- `/gear` (filters), `/consumable`, `/quest`, `/guide` (paginated), `/optimize` (gap
  checklist).
- `/reloadcontent` for fast authoring; content validation in CI.
- Fill remaining 19 classes to `core`-complete.
- **Exit criteria:** `/optimize` returns useful "you're missing X" for every 19 class.

## P4 — Bracket expansion
- Add `29/` (then `49/`) per `06-bracket-expansion.md`; `/brackets` per-guild toggle.
- **Exit criteria:** a second bracket is fully served with **no** code changes beyond data.

## P5 — Cutover & retire wow-timers
- Point production alerts at TwinkHub; decommission the four Python bots (never run both
  against the same channel/role).
- Update `wow-timers` docs to note the migration.

## Later / backlog (unscheduled)
- User loadout saving (`/myset`) — introduces per-user writes → revisit DB choice (SQLite).
- Optional integration surface for `WSG-Queue-Tracker` live queue data as a command.
- Web dashboard / content-authoring UI over the JSON store.
- Image/embed polish (item icons via Wowhead).

## Cross-cutting, from the start
- Keep handlers thin, data fat (no game knowledge in code).
- Bracket/class namespacing everywhere.
- Schema-validate content on boot; fail loud in dev, degrade gracefully in prod.
- Don't re-register slash commands every boot (avoid the "outdated command" thrash).
