# BiS Reference (19 bracket)

The canonical, verified source for level-19 WSG BiS lists. This doc **interprets** the raw
export; it does not replace it. Treat it as the map between an external, community-maintained
sheet and TwinkHub's content store.

## Source

- **Sheet:** "E&T Phone Gnome — BiS-Chart Lvl. 19 PvP", **Horde** tab, managed by
  Cowblackout. Exported to CSV on 2026-07-29.
- **Raw export (verbatim, do not edit):** `plans/data-sources/bis-chart-19-horde.csv`
  (925 lines, 22 build columns). We copy the export byte-for-byte so re-imports are diffable
  and transcription error is zero. When the sheet updates, re-export and drop the new CSV in
  next to it (date-suffix the old one if you want history).
- **Attribution:** community-curated by Cowblackout et al. We reference and cross-check it; we
  do not claim authorship of the list. Per `03-data-model.md`, BiS is **living data**.
- **Scope:** final Classic Era state (post-Phase 6, all pre-TBC unlocked, 1.15.x) — matches
  `meta.json.gameVersion`. No SoD / Anniversary / TBC entries.

### Still outstanding on the source

- **Alliance tab** is not yet exported. The Horde chart omits **Paladin** (Alliance-only) and
  uses Horde-only rings/trinkets (Seal of Sylvanas, Insignia of the Horde). We need the
  Alliance mirror before Alliance faction variants and Paladin gear can be authored.
- **Wowhead ids:** the sheet embeds item links via `HYPERLINK(...)`, so the ids are
  recoverable from the raw cells but were not transcribed into this doc. Backfill `wowheadId`
  per item during authoring (`sourceRef`), don't fabricate them.

## Build taxonomy — the key finding

The chart is not one BiS list per class. Each class is broken into **role builds**, and a
build carries its own item + enchant choice per slot. That is the structure we architect for:
**one class → many builds**, seeded incrementally.

Horde columns present in the export (22 builds):

| Class    | Builds in the Horde chart              |
|----------|-----------------------------------------|
| Druid    | Flag Carrier, Midfield                   |
| Hunter   | Defense, Midfield, Offense               |
| Mage     | Defense, Midfield, Offense               |
| Priest   | Defense, Midfield, Offense               |
| Rogue    | Midfield, Offense                        |
| Shaman   | Defense, Midfield, Offense               |
| Warlock  | Defense, Midfield, Offense               |
| Warrior  | Defense, Midfield, Offense               |
| Paladin  | — (Alliance-only; not on the Horde tab)  |

Role vocabulary observed: **flag-carrier, defense, midfield, offense**. These map onto the
roster roles we already author in `classes/*.json` (flag-carrier / healer / dps / hybrid) but
are finer-grained — a build's `role` is the chart column, not the class role. We keep both:
class-level `roles` (coarse identity) and build-level `role` (the loadout's job).

## Enchants are per-build, not per-item

The single most important schema consequence: **the same item appears in multiple builds with
different enchants.** Examples from the chart:

- **Chest** (Blackened Defias Armor / Tree Bark Jacket): *Major Health* on a carrier/defense
  build, *Greater Stats* on midfield, *Major Mana* on a caster build.
- **Wrist**: *Superior Stamina* vs *Superior Strength* vs *Greater Intellect* vs *Healing
  Power* depending on the build.
- **Weapon**: *Fiery* / *Lifestealing* (melee) vs *Spell Power* / *Healing Power* / *Mighty
  Intellect* / *Mighty Spirit* (caster) on otherwise shared weapons.

Therefore the enchant belongs to the **(build, slot)** pair, never to the item record. The
item registry stores the item; the build says which enchant goes on it. See the schema in
`03-data-model.md` §"Gear: builds".

## Shared / universal picks

Several slots resolve to the same item across most or all builds. These are the `shared[]`
items in `gear/index.json` (owner `shared`), referenced by builds rather than duplicated:

- **Head:** Lucky Fishing Hat, universally, with a **Lesser Arcanum** head enchant
  (Constitution / Rumination / Voracity by build). ⚠️ **Discrepancy to resolve:** our seeded
  `enchants.json` and `03-data-model.md` line ~93 assert "head has no enchant at this
  bracket" and point at Engineering goggles. The verified chart contradicts both — head *does*
  take a Lesser Arcanum, and Lucky Fishing Hat is the BiS frame. Correct the enchant data and
  the goggles note when authoring head gear (needs its own approval + Wowhead check).
- **Neck:** Scout's Medallion.
- **Trinket 1:** Insignia of the Horde (Alliance mirror: PvP insignia equivalent).
- **Trinket 2:** Arena Grand Master or Minor Recombobulator (Engineering).
- **Waist** takes **no enchant** (belt has no enchant slot at this bracket) — the one slot
  where "no enchant" is genuinely correct.

## Per-slot summary (Horde chart)

Slots in chart order, with the item pool observed. Exact per-build assignment lives in the raw
CSV; author from there, don't re-derive from this summary.

- **Head:** Lucky Fishing Hat + Lesser Arcanum of Constitution / Rumination / Voracity.
- **Neck:** Scout's Medallion.
- **Shoulder:** Feral Shoulder Pads / Reinforced Woolen Shoulders / Defender Spaulders +
  *… of the Scourge* shoulder enchant.
- **Back:** Firebane / Sentry / Engineer's Cloak + resistance enchants.
- **Chest:** Blackened Defias Armor / Tree Bark Jacket + Major Health / Greater Stats /
  Major Mana.
- **Wrist:** Wrangler's / Greenweave / Mindthrust / Steel-clasped Bracers + Superior Stamina /
  Superior Strength / Greater Intellect / Healing Power.
- **Hands:** Scouting Gloves / Magefist / Pagan Mitts / … + Superior Agility / Healing /
  Frost Power / Shadow Power / Strength.
- **Waist:** Deviate Scale Belt / Keller's Girdle / Screecher Belt / Cobrahn's Grasp
  (no enchant).
- **Legs:** Scouting Trousers / Darkweave Breeches / Leggings of the Fang + Lesser Arcanum.
- **Feet:** Nat Pagle's Extreme Anglers / Trailblazer / Feet of the Lynx / Draftsman +
  Minor Speed.
- **Finger 1 / 2:** Seal of Sylvanas / Legionnaire's Band / Zircon Band of X Resistance /
  Advisor's Ring / Lavishly Jeweled Ring.
- **Trinket 1:** Insignia of the Horde.
- **Trinket 2:** Arena Grand Master / Minor Recombobulator.
- **Main-hand / weapon:** Wingblade, Massive Battle Axe of Agility, Night Watch Shortsword,
  Shadowfang, Assassin's Blade, Twisted Chanter's Staff, Witching Stave, Cruel Barb, Runic
  Darkblade, Evocator's Blade, Gravestone Scepter, Staff of the Friar, Face Smasher, Furbolg
  Medicine Pouch, Night Reaver, Hook Dagger of Frozen Wrath, Jagged Star of Healing, Staff of
  the Blessed Seer + Fiery / Lifestealing / Spell Power / Mighty Intellect / Healing Power /
  Mighty Spirit.
- **Off-hand / shield:** Deadskull Shield / Redbeard Crest / Arctic Buckler + Greater Stamina /
  Frost Resistance / Thorium Spike.
- **Ranged:** Venomstrike / Outrider's Bow / Keen Throwing Knife / Sharp Arrow / Medium Quiver
  + Accurate Scope.

## How this maps to the store

1. **Item registry** — every distinct item (shared or class) is authored once: `shared[]` in
   `gear/index.json` for universal picks, `gear/<class>.json` `items[]` for class-specific
   ones. Numeric stats / reqLevel / wowheadId are filled as verified, nulled with a
   verify-note otherwise (existing rule; never fabricate).
2. **Builds** — `gear/<class>.json` `builds[]` lists the role loadouts; each build's `slots`
   map references item ids from the registry and names the enchant per slot. See the schema in
   `03-data-model.md`.
3. **Incremental fill** — a class starts with one build (its current anchor migrates in as the
   `default` build), and more builds drop in as data lands, with **no code change**. Adding
   Alliance is a data task (new items + faction-tagged builds), not a schema change.

## Authoring order (data task, gated separately)

1. Land the multi-build schema + loader guards + tests (code change — its own approval).
2. Migrate the existing Hunter/Rogue anchors into `items[]` + a `default` build (no behavior
   change; keeps tests green).
3. Seed the 22 Horde builds from the raw CSV, slot by slot, backfilling `wowheadId`.
4. Export + import the Alliance tab; add Paladin and Alliance faction variants.
5. Resolve the head-enchant discrepancy in `enchants.json` and the `03` note.
