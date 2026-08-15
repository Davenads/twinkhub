# 15 — Manager panel: slot-first "Manage an item" navigation

Review + plan for the manager-panel **"Manage an item…"** dropdown dropping items past
the 25th. Companion to `14-community-stash.md` (which owns the full stash design); this
file is the focused reference for this one fix. **Status: planned, not implemented — awaiting
greenlight.**

## The symptom (manager report)

Expanding the manager console's **"Manage an item…"** dropdown does not list every item —
items beyond a certain count are missing, so they can't be Edited or Withdrawn from the panel.

## Root cause — a hard Discord cap, cap-and-drop today (confirmed)

A Discord **`StringSelectMenu` holds at most 25 options** (`SELECT_LIMIT = 25`,
`services/stash.js:29`). This is a fixed API limit, not a config knob.

`buildManagerPanel` builds the `mitem` select with `manageable.slice(0, SELECT_LIMIT)`
(`services/stash.js:462-482`). `manageable` = every item whose status is in
`{available, requested, given}` (`MANAGE_ORDER`, `:455-461`), sorted **active-first**
(available → requested → given) then by name. So once the stash holds **>25** manageable
items, everything past #25 is **silently dropped** from the dropdown — un-editable,
un-withdrawable via the panel. `given`-status history is sorted last, so it's the first to
fall off, but a big enough live inventory pushes *available* items off too.

**This is the exact class of bug we already fixed on the requester side** — and the manager
`mitem` select never got that treatment.

## The requester side already solved this (reuse it)

Shipped 2026-08-14 (`dbec3c7`), the public panel is slot-first once it overflows:

- `buildStashPanel` branches (`services/stash.js:325-350`): `open.length <= 25` → one flat
  `req` select; else → a **`reqslot`** slot picker (options = the slots present, each labelled
  `N available`).
- `reqslot` → `handleRequestSlot` (`components/stash.js:133-149`) → **`buildSlotRequestPrompt`**
  (`services/stash.js:379-403`): an **ephemeral** `req` select scoped to the chosen slot,
  capped at 25 **with a graceful overflow note** (`Showing the first 25; claim some to see the
  rest.`). Ephemeral so one manager's drill-down never mutates the shared panel message.

The manager fix is a **direct mirror** of this — same shape, manager-scoped data.

## The proposal (user's idea) — and my read

> "Manage an item" lists the **slots** (waist, shoulder, weapon…); pick a slot → a second
> dropdown of that slot's items. Bound the stash size so the 2nd dropdown never hits ~25.

**The slot-first two-step is the right call** — it's the same pattern already shipped for
requesters and already used by the add/edit slot pickers, so it's consistent, low-risk, and
mostly code reuse. **One refinement:** do **not** cap total inventory to keep a slot under 25.
Coupling a business rule (max stash size) to a UI limit is fragile — one popular slot (30 pairs
of boots) still overflows, and it caps the whole giveaway system on a Discord render detail.
Instead, **handle per-slot overflow gracefully** with the same 25 + overflow-note the requester
side already uses. In practice a single equipment slot rarely exceeds 25 manageable items, so
the note is a rare safety net, not a routine state — and the design stays correct at any stash
size.

## Alternatives considered

- **Slash `item_id` autocomplete** (`/stashadmin edit` / a withdraw): Discord slash
  autocomplete filters up to 25 suggestions server-side by typed text, so it scales infinitely
  and is fast for a manager who knows the name. **But** it lives on the slash command, not the
  panel (the user wants the *panel* fixed), and withdraw is panel-only today (`/stashadmin
  remove` was retired). **Verdict: complementary future add, not the primary fix.**
- **Paginated flat select (Prev/Next):** adds pagination state + buttons and a meaningless
  ordering axis. Slot is a semantic axis managers already think in. **Rejected — clunkier.**
- **Status-first then slot:** more steps; status is already in the option description +
  active-first sort. **Rejected as primary.**

**Recommendation: slot-first (mirror `reqslot`), with per-slot overflow handled, not designed
around.** Optionally add slash autocomplete later as a power-user path.

## Design — mirror `reqslot` on the manager side

### customId contract (all under `s1|`)

- **`mslot`** (new) — manager slot picker. Replaces the flat `mitem` select **in the panel**
  only when `manageable.length > 25`; ≤25 keeps the flat `mitem` select (exactly like the
  requester branch).
- **`mitem`** (unchanged id) — per-item select; `value` = item id. Reached from BOTH the flat
  panel select and the scoped ephemeral select. Downstream is untouched: `mitem` →
  `handleManageSelect` (`components/stash.js:388-415`) → `buildItemAction` (Edit/Withdraw).

Flow: `mslot` → `handleManageSlot` → ephemeral `buildManageSlotPrompt` (a scoped `mitem`
select) → `handleManageSelect` → `buildItemAction`. Byte-for-byte the `reqslot`/`req` shape.

### `services/stash.js`

- Extract module-scope helpers from the current inline `buildManagerPanel` block:
  - `MANAGE_ORDER` + a `manageable(items)` filter (mirror of `claimable`, `:183-185`).
  - `manageOptions(items)` (mirror of `claimOptions`, `:172-180`) — per-item option capped at
    25, **keeping the manager-flavoured description** `⚠ no link · <slot> · <status> · ×N`
    (currently inline at `:469-477`), active-first then name sort.
- In `buildManagerPanel`, branch the manage control:
  - `manageable.length <= 25` → flat `mitem` select via `manageOptions` (today's behaviour).
  - else → `mslot` picker: `groupBySlot(manageable).slice(0,25).map(g => { label, value: g.value,
    description: 'N to manage' })` (paper-doll order, Ungrouped last — `groupBySlot` already
    does this, `:142-163`).
- Add **`buildManageSlotPrompt({ items, slot })`** (mirror of `buildSlotRequestPrompt`,
  `:379-403`): filter `manageable`-scoped items to `normalizeSlot(it.slot) === wanted` (with the
  `ungrouped` sentinel → slotless), sort active-first then name, render an ephemeral
  `{ content, components }` with a scoped `mitem` select via `manageOptions`, cap 25 + the same
  overflow note; empty slot → hint + no select.

### `components/stash.js`

- Add **`handleManageSlot(interaction)`** (mirror of `handleRequestSlot`, `:133-149`):
  `requireManager` → `slot = interaction.values[0]` → `deferReply({ ephemeral })` →
  `store.listItems({ statuses: ['available','requested','given'] })` →
  `editReply({ ...buildManageSlotPrompt({ items, slot }), ...SEND_OPTS })`.
- Register `mslot: handleManageSlot` in `HANDLERS` (next to `mitem`). Import
  `buildManageSlotPrompt`. `mitem: handleManageSelect` stays as-is.

### Scope difference to respect (manager vs requester)

Requester `claimable` = `available && remaining>0`. Manager `manageable` =
`{available, requested, given}`, active-first. So the manager helpers must **not** reuse the
claimable-scoped ones — a `given`/fully-claimed item must still appear in its slot bucket so a
manager can edit/withdraw it. Within a slot, keep **active-first then name** (not name-only) so
live stock leads.

## Tests (mirror the `reqslot` suite in `test/services/stash.test.js`)

- `manageable ≤ 25` → panel keeps the flat `mitem` select, no `mslot`.
- `manageable > 25` → panel swaps to `mslot`; per-slot `N to manage` counts; paper-doll order;
  Ungrouped last; no flat `mitem` on the panel.
- `buildManageSlotPrompt` scopes to the slot, active-first + name sort, caps at 25 with the
  overflow note.
- `ungrouped` sentinel scopes to slotless items.
- Empty slot → hint + no select.
- **Manager scope includes `given`** — a `given`-status item appears in its slot bucket
  (distinguishes manager scope from the requester's claimable-only scope).

## Sequencing / deploy

Pure `services` + `components` change. **No `npm run deploy`** (no command *definition* changes
— these are message components). **`pm2 reload` only.** Stateless / reload-safe: the slot rides
the `mslot` → `buildManageSlotPrompt` path via a fresh `listItems`, no in-memory state.

## Edge cases / checks

- **Panel fingerprint (timer tick / `mref`):** crossing the 25 threshold changes counts, so the
  per-guild fingerprint changes and the panel re-renders — verify the branch is reflected (it
  should be, since counts drive the fingerprint).
- **Stale `mslot` option** (slot emptied since render) → `buildManageSlotPrompt` returns the
  empty-slot hint. Handled.
- **Preserve the `⚠ no link` marker** in the scoped per-slot options (via `manageOptions`) so
  the data-quality nudge survives the drill-down.
