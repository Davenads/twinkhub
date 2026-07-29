# Slash Command Surface

Enduser data commands are **open to everyone**. Admin/dev and test commands are gated by the
**"dev" role** (by name, case-insensitive). Timer commands are covered in `02`; repeated
here for the full picture.

Design rules:
- Heavy use of **autocomplete** (item names, class names, guide slugs, enchant names).
- Responses are **embeds**, chunked to Discord limits; long guides paginate via buttons.
- Every content command respects the guild's `activeBrackets`; a `bracket` option defaults
  to the guild's primary bracket (19 initially) and only offers brackets that guild enabled.

## Enduser — data / knowledge

| Command | Options | Returns |
|---|---|---|
| `/bis` | `class` (req), `slot?`, `bracket?` | Best-in-slot list for a class (all slots, or one). The flagship command. |
| `/gear` | `class`, `slot?`, `faction?`, `priority?`, `bracket?` | Filterable gear entries (core/situational/budget). |
| `/item` | `name` (autocomplete), `bracket?` | A single item's stats, source, faction, notes, Wowhead link. |
| `/enchant` | `slot?`, `class?`, `bracket?` | Enchants for a slot/class; **flags no-level-requirement** ones. |
| `/consumable` | `type?` (potion/poison/food/explosive/worldbuff), `class?`, `bracket?` | Recommended consumables. |
| `/class` | `class` (req), `bracket?` | Class overview: tier, role(s), stat priority, spec notes, faction notes. |
| `/tierlist` | `bracket?` | The bracket's class tier ranking with one-line rationales. |
| `/quest` | `class?`, `faction?`, `bracket?` | Gear-reward quests worth doing pre-cap; **flags XP-risk turn-ins**. |
| `/guide` | `slug` (autocomplete) or `class?`/`tag?` to browse | Curated long-form guide, paginated. |
| `/optimize` | `class` (req), `faction?`, `bracket?` | A checklist: are you missing a core slot / enchant / consumable / profession? A "did you forget X" pass. |
| `/xprules` | `bracket?` | Explains XP management for the bracket (e.g. **19: no XP-off toggle in Classic Era**, how to avoid dinging 20). Enduser FAQ. |
| `/statweights` | `class` (req), `bracket?` | Stat conversions/priority for a class (from `scaling.json`) — e.g. STR→AP, AGI→crit/dodge/armor, STA→HP, hit caps — so players understand *why* an item wins. |
| `/spellcoef` | `class` (req), `bracket?` | Level-19 spell power coefficients for a caster/hybrid's spells (grouped by damage/heal/DoT), plus the sub-level-20 penalty note (from `spellcoefficients.json`) — the caster counterpart to `/statweights`. Melee classes get a clean "no spell scaling at 19" reply. |
| `/pets` | `family?`, `bracket?` | Hunter pet recommendations: optimal families/abilities, tame levels/zones, and the pet-XP management note. |

### `/optimize` note
`/optimize` is the differentiator: it cross-references the class's `core` gear/enchant list
against a checklist and returns the gaps, plus reminders (profession pick, PvP trinket,
faction-specific pickups). Pure read over the content store — no user data stored in v1.

## Enduser — events (timers)

| Command | Options | Returns |
|---|---|---|
| `/events` | — | Dashboard of all tracked events (BG rotation + AGM/DMF/STV), next-fire countdowns, active/idle, sorted by urgency. |
| `/nextevent` | — | The single soonest-firing event. |

## Admin / dev (gated by "dev" role)

| Command | Options | Effect |
|---|---|---|
| `/setup` | `channel`, `role` | Set the guild's alert channel + alert role. Preserves existing `dmEnabled`. |
| `/alerts` | `event` (bg/agm/dmf/stv), `state` (on/off) | Per-event alert toggle for this guild. |
| `/timerdms` | `state` (on/off) | Per-guild DM fan-out toggle (unifies the four `/*dms` commands). |
| `/timerboard` | `channel` or `off` | Create/move the persistent auto-updating timer board (a bot-owned message edited every tick), or tear it down. Board channel is independent of the alert channel. See `02` §"Persistent timer board". |
| `/brackets` | `bracket`, `state` (on/off) | Enable/disable a content bracket for this guild (default: 19 on). |
| `/panels` | `post channel:` / `refresh` / `remove` | Post / re-render / tear down the persistent interactive enduser panels (bot-owned embeds with buttons & select menus → ephemeral results). Best practice: a read-only channel. Self-heals deleted messages on `refresh`. See `08-enduser-panels.md`. |
| `/testevent` | `event`, `warning?` (bool) | Fire an event message on demand. `warning:true` → advance ping + DM; `warning:false` → occurrence (silent for AGM/STV, ping for BG/DMF). AGM spawn stays DM-free. Mirrors `wow-timers` test semantics exactly. |
| `/reloadcontent` | — | Re-read + re-validate the content store from disk without restart (strict reload; keeps last-good on error; reports a per-bracket summary), for authoring. |

## Registration strategy

- **Test server:** register guild-scoped for instant updates during development.
- **Production:** register global. Do **not** re-register every boot (avoids the
  "command outdated" cache thrash seen in `wow-timers`). Re-run `deploy-commands.js` only
  when a command's signature changes.

## Error / UX conventions

- Unknown class/slot/item → ephemeral, friendly "did you mean…" using the autocomplete
  index.
- Content-not-found for an enabled bracket → ephemeral "no data yet for X" (never a crash).
- Dev-gated command by a non-dev → clean ephemeral "you need the **dev** role" (ported
  behavior).
- All enduser data responses are **non-ephemeral by default** (shareable), with an optional
  `private:true` flag on the big ones (`/bis`, `/guide`) to keep a channel tidy.
