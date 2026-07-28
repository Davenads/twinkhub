# Timers Module — Consolidating the Four wow-timers Bots

Goal: reproduce the **event logic** of the four Python bots (`bot_bg`, `bot_agm`,
`bot_dmf`, `bot_stv`) as **one subsystem inside TwinkHub**, improving where consolidation
allows and **dropping the machinery that only makes sense when each event is its own bot**.

Source of truth for current behavior: `wow-timers/python-bots/shared.py` and the per-bot
files. This doc records exactly what to carry over and what to change.

---

## The four events (behavior to preserve)

All schedules are **Mountain Time** (`America/Denver`), DST-safe.

| Event | Schedule | Advance ping | Occurrence | Delivery style |
|---|---|---|---|---|
| **BG Weekend** | Thu 2am → Tue 2am; rotates **AV → EOTS → WSG → AB** | none | **pings** on go-live | occurrence-ping |
| **Arena Grand Master (AGM)** | every 3h from midnight, 5-min window | **10-min** ping | silent post | advance-ping + silent |
| **Darkmoon Faire (DMF)** | first full week each month, Mon 00:01 | none | **pings** on open | occurrence-ping |
| **STV Fishing** | Sundays 2–4pm | **30-min** ping | silent post | advance-ping + silent |

**Two style pairs — keep them in lockstep unless told otherwise:**
- **AGM + STV:** the role is pinged only by the *advance* warning; the actual occurrence
  post is silent (`broadcast`).
- **BG + DMF:** no advance warning; the role is pinged on the occurrence itself (`ping`).

**BG rotation anchor:** `_BG_ANCHOR = 2026-03-24 08:00 UTC` (a confirmed AV week). Port this
constant exactly; rotation index derives from weeks elapsed since the anchor.

## State computation (port these pure functions)

`shared.py` exposes four pure state functions returning ms-based dicts:
`get_rotation_info` (BG), `get_agm_state`, `get_dmf_state`, `get_stv_state`. Reimplement
each as `events/<event>.js → getState(now)`, returning a normalized shape:

```js
// getState(now) ->
{
  active: boolean,        // is the event currently happening
  startsInMs: number,     // ms until next start (0 if active)
  endsInMs: number,       // ms until current window ends (if active)
  label: string,          // e.g. "WSG" for BG rotation, else event name
  meta: { /* per-event extras, e.g. rotation index */ }
}
```

Keep them **pure and `now`-injectable** (default `DateTime.now()` in MT) so they're unit-
testable exactly like the Python versions — this is what makes the schedule logic
verifiable without waiting for real time.

## Edge detection & latches (DO NOT break these)

The subtle, correctness-critical part. Reproduce faithfully:

- **Occurrence edge** (`was_active` / `was_up` in Python): fire the occurrence message only
  on the **false → true** transition, not every tick while active.
- **Advance-warning latch** (`warned_30` STV / `warned_next` AGM): fire the advance ping
  **once**, then **re-arm only after the window has clearly passed**, so a process restart
  mid-window does **not** double-ping.

Persist latch state across restarts (small JSON or in-memory + generous re-arm window) so a
crash-loop can't spam. This was handled implicitly per-bot; in one process, store latches
keyed by event.

## Delivery policy per event (which of the 3 modes, and when)

Reuse the three delivery functions (`ping` / `broadcast` / `dm`) from `01-architecture.md`.
Each event fires channel delivery **and** DM fan-out at its triggers, matching production:

| Event | Trigger | Channel mode | DM fan-out |
|---|---|---|---|
| STV | 30-min warning | `ping` | **yes** |
| STV | start (occurrence) | `broadcast` (silent) | **yes** |
| AGM | 10-min warning | `ping` | **yes** |
| AGM | spawn (occurrence) | `broadcast` (silent) | **no** — spawn stays DM-free |
| DMF | open (occurrence) | `ping` | **yes** |
| BG | go-live (occurrence) | `ping` | **yes** |

Note the one asymmetry to preserve: **AGM's spawn is both silent AND DM-free**; only its
10-min warning DMs.

## What we DROP (single-bot consolidation)

These exist only because each event was its own bot with its own Discord identity. A single
consolidated bot has **one** avatar, **one** nickname, **one** presence — so:

- **Per-event avatar swapping** (`do_update` swaps `arena.png` / `fishing.png` / etc. on
  state change) — **removed.** TwinkHub has one static avatar.
- **Per-event server nickname with ①②③④ prefix** (`compute_rank` / `rank_prefix`) —
  **removed** as a nickname mechanic. The ranking *idea* (urgency ordering) is repurposed
  only for sorting inside the `/events` command output, not for renaming the bot.
- **Per-event presence/status string** set every minute — **replaced** by a single
  optional presence that shows the **most urgent upcoming event** (or a static string).
  This is cosmetic; if it adds noise, make it static. Do not rename the bot per event.
- Four separate tokens / four processes / four config files → **one** token, one process,
  one per-guild config with a `timers` toggle map.

## What we KEEP / improve

- All four `getState` schedule computations (BG anchor, AGM 3h windows, DMF first-full-week,
  STV Sunday window) — verbatim logic, re-expressed in JS/luxon.
- The three delivery modes and their per-event assignment (table above).
- Dev-role gating for test commands.
- Per-guild config, `dmEnabled` default-on, preserved across re-setup.
- **Improvement — per-guild event toggles:** a guild can enable/disable individual events
  (`timers.bg=false`, etc.) instead of all-or-nothing-by-inviting-a-bot.
- **Improvement — one `/events` command** shows all four at once (next fire, active/idle,
  BG's current rotation), sorted by urgency. The four bots can't do this; the consolidated
  one can.

## Timer command surface (see 04-commands.md for full detail)

- `/events` — enduser: dashboard of all tracked events, next-fire countdowns, BG rotation.
- `/nextevent` — enduser: the single soonest event.
- `/setup` — dev: set alert channel + role (admin doc).
- `/alerts <event> <on|off>` — dev: per-event toggle for this guild.
- `/timerdms <on|off>` — dev: per-guild DM toggle (analogue of `/stvdms` etc., unified).
- `/testevent <event> [warning:bool]` — dev: fire an event's message on demand. Mirrors
  `/teststv`/`/testagm` semantics: `warning:true` fires the advance ping **and** DMs;
  `warning:false` fires the occurrence (silent for AGM/STV, ping for BG/DMF). AGM's spawn
  branch stays DM-free, exactly as today.

## Migration / cutover note

Run TwinkHub's timer module **alongside** `wow-timers` on a **separate test channel/role**
first. Verify each event's edge + latch behavior against the Python bots for at least one
full cycle of each (AGM every 3h is quick; STV weekly; DMF monthly is the long pole) before
pointing production alerts at TwinkHub and retiring the Python bots. **Never run both against
the same channel/role** — that double-pings.
