# Timers Module — Consolidating the Four wow-timers Bots

Goal: reproduce the **event logic** of the four Python bots (`bot_bg`, `bot_agm`,
`bot_dmf`, `bot_stv`) as **one subsystem inside TwinkHub**, improving where consolidation
allows and **dropping the machinery that only makes sense when each event is its own bot**.

> **Target realm: WoW Classic Era — NOT the Anniversary progression realms.** The
> `wow-timers` bots serve Anniversary/TBC-era servers, so their schedules were the *starting
> point*, not gospel: wherever Era's event cadence differs, TwinkHub follows **Era**. Three
> corrections are already baked in (all verified against the NovaWorldBuffs Classic addon):
> **BG** rotates only **AV → WSG → AB** (Eye of the Storm is a TBC BG, never in Era); **AGM**
> spawns on the **odd hours** (01:00, 04:00 … 22:00 MT), one hour later than the naive port;
> **DMF** opens the **Sunday** after first-Friday construction and rotates only **two zones**
> (Elwynn Forest / Mulgore), never the 3-zone Anniversary/TBC table. STV (Sun 2–4pm) is
> identical on both realms.

Source of truth for current behavior: the shipped `src/timers/events/*.js` (Era-corrected).
The original port reference is `wow-timers/python-bots/shared.py`, but where the two disagree,
**Era wins**. This doc records what to carry over and what to change.

---

## The four events (behavior to preserve)

All schedules are **Mountain Time** (`America/Denver`), DST-safe, and target **Classic Era**.

| Event | Schedule (Classic Era) | Advance ping | Occurrence | Delivery style |
|---|---|---|---|---|
| **BG Weekend** | Thu 2am → Tue 2am MT; rotates **AV → WSG → AB** (3 BGs, no EOTS) | none | **pings** on go-live | occurrence-ping |
| **Arena Grand Master (AGM)** | every 3h at **01:00, 04:00, … 22:00 MT**, 5-min window | **10-min** ping | silent post | advance-ping + silent |
| **Darkmoon Faire (DMF)** | construction first Friday; **opens the following Sunday ~02:00 MT** for 7 days; zone alternates **Elwynn Forest / Mulgore** | none | **pings** on open | occurrence-ping |
| **STV Fishing** | Sundays 2–4pm MT | **30-min** ping | silent post | advance-ping + silent |

**Two style pairs — keep them in lockstep unless told otherwise:**
- **AGM + STV:** the role is pinged only by the *advance* warning; the actual occurrence
  post is silent (`broadcast`).
- **BG + DMF:** no advance warning; the role is pinged on the occurrence itself (`ping`).

**BG rotation anchor:** `BG_ANCHOR = 2026-07-28 08:00 UTC` (Tue) — a confirmed **AB** week
(`ANCHOR_INDEX = 2`), whose weekend fell on Aug 1–2 2026. The 3-BG rotation index derives from
whole weeks elapsed since the anchor. (The old `2026-03-24` AV-week anchor belonged to the
4-BG Anniversary rotation and no longer applies on Era.)

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

- All four `getState` schedule computations (BG anchor + 3-BG rotation, AGM 3h/+1h-phase
  windows, DMF first-Friday→Sunday open + 2-zone rotation, STV Sunday window) — re-expressed
  in JS/luxon and **corrected for Classic Era**, not a verbatim copy of the Anniversary port.
- The three delivery modes and their per-event assignment (table above).
- Dev-role gating for test commands.
- Per-guild config, `dmEnabled` default-on, preserved across re-setup.
- **Improvement — per-guild event toggles:** a guild can enable/disable individual events
  (`timers.bg=false`, etc.) instead of all-or-nothing-by-inviting-a-bot.
- **Improvement — one `/events` command** shows all four at once (next fire, active/idle,
  BG's current rotation), sorted by urgency. The four bots can't do this; the consolidated
  one can.
- **Improvement — a persistent timer board** (below): an always-on, self-refreshing status
  message. Impossible cleanly with four separate bots; natural with one.

## Persistent timer board (live-updating dashboard message)

Beyond fire-time pings/DMs, a guild can opt into a **persistent timer board**: a single
bot-owned message the bot **edits in place every tick (60s)** to show **all tracked events
with live countdowns** — effectively `/events` as an always-on, self-refreshing dashboard
that lives in a dedicated channel (e.g. `#wow-timers`).

- **Config:** `timerBoard: { channelId, messageId }` per guild (`null` when unset). This is
  **separate from the alert channel** — the board can sit in its own channel while pings go
  elsewhere, or both can share a channel. Stored in the per-guild config JSON.
- **Setup:** `/timerboard channel:<#chan>` (dev-gated) posts the initial embed, saves its
  `messageId`, and pins it if permitted. `/timerboard off` deletes/forgets the board.
- **Tick behavior:** each 60s tick, after states are computed, every guild with a board gets
  its stored message **edited** with the refreshed embed (per-event countdowns, active/idle,
  BG rotation, soonest-next). Editing one message = zero channel spam.
- **Self-healing:** if the stored message is gone (deleted, or the edit 404s), **repost once**
  and update `messageId`. If the channel is missing or perms were revoked, log it and
  **clear** the board config so we stop retrying.
- **Always silent & ambient:** the board posts/edits with `allowedMentions: { parse: [] }`
  and **never pings**. It is a *status board*, not an *alarm* — it does **not** replace the
  edge-triggered ping/broadcast/DM deliveries, which still fire independently.
- **Freshness cue:** footer carries a Discord relative timestamp (`<t:unix:R>` "updated N
  seconds ago") so the board reads as live even between the once-a-minute edits.
- **Permissions/limits:** needs View Channel + Send + Embed Links (+ Manage Messages to
  pin) in the board channel; one edit/min/guild is trivially within rate limits.
- **Reuses `/events` rendering:** build the board embed from the same formatter `/events`
  uses, so the on-demand command and the persistent board never drift.

## Timer command surface (see 04-commands.md for full detail)

- `/events` — enduser: dashboard of all tracked events, next-fire countdowns, BG rotation.
- `/nextevent` — enduser: the single soonest event.
- `/setup` — dev: set alert channel + role (admin doc).
- `/alerts <event> <on|off>` — dev: per-event toggle for this guild.
- `/timerdms <on|off>` — dev: per-guild DM toggle (analogue of `/stvdms` etc., unified).
- `/timerboard <#channel|off>` — dev: create/move or tear down the persistent, auto-updating
  timer board message (see above).
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
