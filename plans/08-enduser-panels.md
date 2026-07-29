# Interactive Enduser Panels (Button/Select Surface)

A **click-driven alternative to the slash commands** for endusers. A dedicated, read-only
channel holds a small set of **persistent bot-owned embeds** ("panels"), each with
**buttons and select menus** at the bottom. Clicking a control returns an **ephemeral**
message (visible only to the clicker) produced by the **same logic** the equivalent slash
command uses — e.g. class builds, gear/BiS, enchants, consumables.

This is the third persistent-channel surface, alongside:
- **Timer board** (`02`) — auto-updating status message (ambient, no interaction).
- **Alert channel** (`02`) — edge-triggered pings/DMs.
- **Panels channel** (this doc) — interactive, on-demand data access.

They can share one hub channel or live separately (per-guild config).

---

## Why buttons persist forever (the key mechanic)

Message components are **not registered** like slash commands. A button/select just fires an
`interactionCreate` event carrying its **`customId`**. As long as the running bot has an
interaction router that recognizes that `customId`, the control keeps working **indefinitely
and across restarts** — the persistent message needs **no server-side session state**.

Consequence: post the panels **once**; they work forever. The only requirement is the
component router + handlers being present in the running bot. No DB, no re-posting on boot.

## `customId` schema (the contract)

- **Format:** `p1|<action>|<arg?>|<arg?>` — pipe-delimited, **≤100 chars** (Discord's hard
  limit), **versioned** with the `p1` prefix.
  - The `p1` version prefix lets the router detect **stale** buttons after an encoding change
    and reply "this panel is out of date — ask an admin to `/panels refresh`."
  - `action` = the logical operation (`bis`, `class`, `enchant`, `consumable`, `gear`,
    `xprules`, `tierlist`, `statweights`, `spellcoef`, `pets`, `guide`, `pick`).
  - `arg`s = short **slugs** only (class slug, slot, bracket, guide slug). Never free text.
- **Examples:**
  - Button "XP Rules" → `p1|xprules`
  - Class picker select (context = show build) → customId `p1|pick|bis`; the chosen class
    arrives in `interaction.values[0]`.
  - Follow-up button on an ephemeral result → `p1|enchant|hunter` (carries the class so the
    next click needs no re-pick).
  - Multi-bracket → append bracket: `p1|bis|hunter|29`. Omitted ⇒ guild's primary bracket.
- **Router:** `customId.split('|')` → check `parts[0] === 'p1'` → dispatch by `parts[1]`.

## Shared service layer (the non-negotiable rule)

Buttons must **never** duplicate command logic. Refactor each data command's body into a
**service/render function** that returns a renderable payload:

```
renderBis({ classSlug, bracket, faction }) -> { embeds, components }
renderEnchant({ slot, classSlug, bracket }) -> { embeds, components }
renderClass({ classSlug, bracket }) -> { embeds, components }
...
```

Both the **slash command `execute()`** and the **panel component handler** call the same
function and just attach the right `flags` (ephemeral for panels). This keeps the two
front-ends from ever drifting and is the single most important architectural constraint for
this feature. → P2/P3 slash commands should be written against this service layer from day
one (see `07-roadmap.md` cross-cutting note).

## Panel catalogue (initial)

Keep panels to **high-traffic enduser reads**. Controls and their options are **generated
from the content store** (class list, slots, guide slugs) so adding a class/guide makes it
appear on the next `/panels refresh` — never hardcoded.

1. **Class Builds & BiS** — embed + a **class select menu** (options = the bracket's class
   index, with per-class emoji). Pick a class → ephemeral `renderBis(class)` (same as `/bis`
   / `/class`). The ephemeral result carries **follow-up buttons**: `Enchants`, `Consumables`,
   `Stat Weights`, `Spell Scaling` (casters/hybrids only), `Pets` (Hunter only) — each customId
   carries the class, so no re-picking.
2. **Enchants** — a **slot select** → ephemeral list of enchants for that slot, **no-level-req
   flagged** (same as `/enchant`).
3. **Consumables** — buttons per **type**: `Potions`, `Poisons`, `Food`, `Explosives`,
   `World Buffs` → ephemeral list (same as `/consumable type:`).
4. **Reference** — buttons: `XP Rules` (`/xprules`), `Tier List` (`/tierlist`), and a **guide
   select** (options = guide slugs) → ephemeral guide (paginated with buttons, same as
   `/guide`).
5. **(Optional) Bracket switch** — only rendered when the guild has **>1 active bracket**: a
   bracket select that re-renders the panel's ephemeral results with the chosen bracket baked
   into follow-up customIds (since each click is stateless, bracket context travels in the
   customId, not server memory).

Component budget: 5 buttons/row, 5 rows (25 controls) per message — comfortably enough; use
select menus (≤25 options) wherever the list is long (classes, slots, guides).

## Interaction flows (concrete)

- **One-step:** button `p1|xprules` → handler → `interaction.reply({ ...renderXpRules(), flags: Ephemeral })`.
- **Two-step (pick → show):** select `p1|pick|bis` → user picks `hunter` → handler reads
  `interaction.values[0]`, calls `renderBis({ classSlug: 'hunter' })` → ephemeral reply whose
  own buttons are `p1|enchant|hunter`, `p1|pets|hunter`, etc.
- **All ephemeral:** many users hit the same panel simultaneously with **zero collision** —
  each gets a private response. The public panel message itself never changes on a click.

## Component module + router

- `src/components/` — one handler module per action (or grouped), each exporting
  `{ action, handle(interaction) }`. A loader builds a registry keyed by `action` (mirrors
  the command loader in `commands/index.js`).
- Extend the `interactionCreate` router: if `interaction.isButton()` or
  `interaction.isAnySelectMenu()`, parse the `customId`, verify the `p1` version, look up the
  handler by `action`, call `handle()`. Unknown/stale → ephemeral "panel out of date" hint.
- Errors handled exactly like commands (ephemeral fallback, logged).

## Admin: posting & maintaining panels

Dev-gated `/panels` command (see `04-commands.md`):
- `/panels post channel:<#chan>` — posts the full panel set into the channel; stores each
  message id in guild config. Best practice: the channel is **read-only for @everyone** so
  only the bot posts and users interact solely via controls.
- `/panels refresh` — re-renders/edits the stored panel messages in place. Needed when the
  catalogue changes, content-derived options grow (new class/guide), or the customId version
  bumps. **Self-heals:** if a stored message is gone, repost it.
- `/panels remove` — deletes/forgets the panels.

Panels are largely **static** (their controls rarely change), so refresh is occasional.

## Config additions (per-guild)

```json
"panels": {
  "channelId": "…",
  "messageIds": { "classBuilds": "…", "enchants": "…", "consumables": "…", "reference": "…" }
}
```
Optional, **defaults `null`**. Independent of `alertChannelId` and `timerBoard`.

## Persistence & restart behavior

- Controls survive restarts with no action (stateless — see the key mechanic above).
- Never auto-repost on boot. Repost only via `/panels refresh` self-heal when a message was
  manually deleted.
- After a `customId` version bump (`p1` → `p2`), old buttons route to the "out of date"
  path until an admin refreshes.

## Permissions

Bot needs **View Channel + Send Messages + Embed Links** in the panels channel (no special
perms for components themselves). Recommend the channel be **read-only for @everyone** so the
panels stay at the top and the surface reads like a menu.

## Non-goals / guardrails

- Controls expose **enduser reads only** — **never** admin/config or any state-writing action
  behind a public button. (No destructive actions one click away for anyone.)
- All game knowledge stays in the content store; labels/options are **generated** from it.
- `customId`s stay **≤100 chars**, slug-only, and **versioned**.
- Panels are an **alternate front-end**, not a replacement — slash commands remain for power
  users, autocomplete, and parametric queries (`/item name:`, filters). Panels cover the
  common "show me X" paths (class builds, gearsets, enchants, consumables, reference).

## Dependencies / sequencing

Depends on the **service layer** and the **P2 (and some P3) data commands** existing. Slated
as its own roadmap phase **after P3** — see `07-roadmap.md` "P4 — Interactive enduser panels".
