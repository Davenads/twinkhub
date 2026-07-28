# TwinkHub — Project Overview

**Status:** Planning only. No implementation code yet. This folder (`plans/`) is the
authoritative spec until we start building.

**Directory:** `C:\Projects\TwinkHub`
**Framework:** [discord.js](https://discord.js.org) v14 (Node.js) — deliberately **not**
Python, unlike the sibling `wow-timers` project.
**Stub:** root `package.json` is a minimal placeholder so the Betty tooling can
`project set` onto this repo. There is no runnable app yet.

---

## What this is

A **single, generalized Discord bot** for the WoW **Classic Era** twinking community.
Two capability pillars:

1. **Data / knowledge commands** — the main event. A wide surface of enduser slash
   commands answering "what gear / enchant / consumable / quest / spec should I use,"
   plus curated guides and optimization help.
2. **Event timers** — a consolidated, improved re-implementation of the recurring
   in-game event logic currently split across the four `wow-timers` Python bots
   (BG Weekend, Arena Grand Master, Darkmoon Faire, STV Fishing), folded into this one
   bot. See `02-timers-module.md`.

## Initial audience & scope

- **Bracket first shipped:** **Level 19**, WoW **Classic Era**, the 10–19 Warsong Gulch
  (WSG) twink community.
- **Game version target:** the **final, fully-unlocked Classic Era** state — **post-Phase 6
  (Naxxramas released), all pre-TBC content available**, live client **1.15.x**. Author to
  the finished pre-TBC game, never a mid-progression snapshot. **Not** Season of Discovery,
  **not** the Anniversary progression realms (that's `wow-timers`' world), **not** TBC. See
  `05-19-twink-domain.md` §"Game version target" and `meta.json.gameVersion` in `03`.
- **Designed to expand:** the content model is bracket-namespaced from day one so we can
  add **29 / 49 / (later) higher brackets** without re-architecting. See
  `06-bracket-expansion.md`. Nothing about the code should hard-assume "19." Every bracket
  shares the same game-version target above.

## Relationship to sibling projects

| Project | What it is | Relationship |
|---|---|---|
| `wow-timers` (Python, 4 bots) | The existing event-timer bots | We **port + consolidate** their event logic here (see `02`). `wow-timers` keeps running until TwinkHub's timer module is proven. |
| `WSG-Queue-Tracker` (planning) | Bot + WeakAura tracking WSG queue pop / game start-end | **Sibling, not merged.** Its live-queue telemetry could later surface here as a command, but that project stays separate for now. |

## Non-goals (initial)

- **No per-event bot identity theatrics.** The four Python bots each swap their **avatar,
  nickname (①②③④ prefix), and presence** per event. A single consolidated bot has one
  identity, so that machinery is intentionally dropped/redesigned — see `02` §"What we
  drop."
- **No account/auth integration, no in-game API scraping** in v1. Content is
  curated/authored data (see `03-data-model.md`), not live-pulled from the game.
- **No live WSG queue tracking in v1** — that is `WSG-Queue-Tracker`'s job.
- **No write/economy features** (no loadout saving per user) until the read surface is
  solid. Listed as a later roadmap item.

## Design principles

- **Thin command handlers, fat data.** Commands read from a modular, validated content
  store; they don't hardcode game knowledge. Adding a new BiS item = a data edit, not a
  code change.
- **Bracket- and class-namespaced content** so expansion is additive.
- **Portable access control** — dev/admin commands gated by a role *named* "dev"
  (case-insensitive, by name not ID), same pattern proven in `wow-timers/shared.py`.
- **Everything server-configurable per guild** (channel, alert role, which brackets are
  active, DM opt-in), stored as per-guild JSON, defaulting sanely.

## Doc map

| File | Purpose |
|---|---|
| `00-overview.md` | This file — vision, scope, non-goals. |
| `01-architecture.md` | discord.js structure, project tree, persistence, deploy. |
| `02-timers-module.md` | Consolidated event-timer subsystem (port of the 4 bots). |
| `03-data-model.md` | Modular content store: schema, namespacing, authoring. |
| `04-commands.md` | Full slash-command surface (data + timers + admin). |
| `05-19-twink-domain.md` | Domain research grounding the 19 content (verified facts). |
| `06-bracket-expansion.md` | Scaling 19 → 29 / 49 / beyond. |
| `07-roadmap.md` | Phased build plan and milestones. |
