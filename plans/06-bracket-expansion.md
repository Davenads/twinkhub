# Bracket Expansion — 19 → 29 / 49 / Beyond

We ship **19** first, but nothing may hard-assume "19." This doc defines how additional
brackets slot in **additively**.

## Why it's cheap if we do it now

The content store is **bracket-namespaced from day one** (`data/content/<bracket>/…`, each
bracket the same internal shape — see `03-data-model.md`). The loader is bracket-agnostic.
So adding a bracket is:

1. Create `data/content/29/` with the same folder shape as `19/`.
2. Fill in `meta.json`, `classes/`, `gear/`, `enchants.json`, `consumables.json`,
   `quests.json`, `guides/` for that bracket.
3. Register `"29"` in `data/content/index.json`.
4. (Per guild) `/brackets bracket:29 state:on`.

**No code changes** for a new bracket if the data conforms to the schema. That is the whole
point of the namespacing.

## What actually differs per bracket

- **Level cap & battleground:** 19→WSG, 29→WSG, 39→AB opens, 49→AB/WSG, etc. Encoded in
  each bracket's `meta.json` (`levelRange`, `levelCap`, `battleground`).
- **Available gear/enchants/abilities:** higher brackets unlock more (e.g. more spells,
  higher-req enchants, Arathi Basin at 20+, librams/leg enchants at higher levels). Pure
  data differences.
- **XP rules:** the "no XP-off toggle in Classic Era" fact is **constant** across brackets;
  only the cap number changes. `meta.json.xpLock` stays structurally identical.
- **Game version:** **constant** across every bracket — all target the final Classic Era
  state (post-Phase 6 / Naxx, all pre-TBC content, patch 1.15.x). `meta.json.gameVersion`
  carries the same value in `19/`, `29/`, `49/`. A new bracket never introduces SoD/TBC/
  Anniversary-phased content; "more unlocks at higher level" means higher-*level* pre-TBC
  items/spells, not a different game version.
- **Class tiers shift** by bracket — a class strong at 19 may fall off at 29/49. Each
  bracket keeps its own `classes/index.json` tiers; never share tier data across brackets.
- **Faction asymmetries change** (different vendors/quests unlock). Modeled per item, so it
  just re-fills with bracket-appropriate data.

## Command behavior across brackets

- Every data command takes an optional `bracket` and defaults to the guild's **primary**
  bracket (first in `activeBrackets`, initially 19).
- Autocomplete and results are **scoped to enabled brackets** so a WSG-19 guild never sees
  49 data unless they opt in.
- `/brackets` (dev) toggles which namespaces a guild exposes. A guild can run multiple
  brackets at once (e.g. a community that twinks 19 and 29).

## Guardrails so expansion stays clean

- **Never** put bracket-specific numbers in code — always in `<bracket>/meta.json`.
- Keep per-class files small and bracket-local; do not create a "shared 19/29 gear" file —
  duplicate the entry into each bracket even if identical, so brackets evolve independently.
- Schema is **versioned** (`index.json.schemaVersion`); if a later bracket needs a new
  field, bump the schema and migrate all brackets, don't fork the schema per bracket.
- Add a bracket only when its **`core` gear slots are filled for the common classes** —
  half-populated brackets should stay disabled to avoid empty `/bis` results.

## Likely order

1. **19** (WSG) — first ship.
2. **29** (WSG) — closest neighbor, same BG, similar mechanics.
3. **49** (AB/WSG) — larger gear pool, more abilities.
4. Higher brackets as community demand appears.
