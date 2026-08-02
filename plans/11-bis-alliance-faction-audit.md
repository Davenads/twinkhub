# BiS Alliance-Side Faction Audit (19 bracket)

A comprehensive review of faction availability across every `/bis` build and item, to make
the Alliance side correct and complete. Companion to `09-bis-reference.md` (which mapped the
Horde chart into the store). **This is a data-quality audit and gap list — no code change is
required to remediate the findings, and none of the fixes below alter the schema.**

## TL;DR — where we actually stand

The Alliance side is **already largely authored**. Every "both-faction" class carries a full
set of Horde *and* Alliance builds; the two single-faction classes are correctly single-sided:

| Class   | Horde builds | Alliance builds | Notes |
|---------|--------------|-----------------|-------|
| Warrior | 3 (off/mid/def) | 3 | Reference template — cleanest Alliance authoring |
| Mage    | 3 | 3 | Alliance = shared-slot swaps only (no class faction items) |
| Priest  | 3 | 3 | Alliance = shared-slot swaps only |
| Warlock | 3 | 3 | Alliance = shared-slot swaps only |
| Hunter  | 3 | 3 | Most faction complexity (blades, quivers) — **1 bug** |
| Rogue   | 2 (off/mid) | 2 | Clean |
| Druid   | 2 (fc/mid) | 2 | Clean |
| Shaman  | 3 | — | **Horde-only class** (correct; no Alliance mirror needed) |
| Paladin | — | 3 (fc/mid/off) | **Alliance-only class** (correct; no Horde mirror needed) |

So the task is **not** "build the Alliance side from scratch." It is: (1) fix the handful of
faction leaks/mislabels found below, (2) resolve orphaned/unused items, (3) evaluate the
weapon gaps the community raised (notably **Glacial Stone**), and (4) add a loader guard so a
faction leak can never silently ship again.

## How faction works in the data model

Two independent `faction` fields, both `"horde" | "alliance" | "both"`:

1. **Item-level** (`gear/index.json` `shared[]` and `gear/<class>.json` `items[]`): where the
   item can be *obtained*. `"both"` = available to either faction (world drop, neutral
   dungeon, neutral vendor, crafted). `"horde"`/`"alliance"` = faction-gated (faction PvP
   vendor, faction-only quest).
2. **Build-level** (`builds[].faction`): which faction the *loadout* is authored for. The
   render service picks the build; `renderBuildView` already filters "Other builds" to the
   chosen build's faction so the switch list never offers the wrong side.

**The invariant that matters:** a build tagged `alliance` must never reference an item whose
item-level faction is `horde` (and vice-versa). `"both"` items are legal in either. Nothing in
the loader currently enforces this — which is exactly how the hunter bug below slipped in.

## The canonical Horde ⇄ Alliance mirror table

Every faction-gated pick and its opposite-faction equivalent. Bold = the id present in the
store today; ⚠️ = missing or mistagged.

| Slot   | Horde                         | Alliance                        | Store status |
|--------|-------------------------------|---------------------------------|--------------|
| Finger | **Seal of Sylvanas** (`horde`) | **Seal of Wrynn** (`alliance`) | ✅ both authored & tagged right |
| Finger | **Legionnaire's Band** (`horde`) | **Protector's Band** (⚠️ `both`) | ⚠️ Protector's Band mistagged `both`; should be `alliance` |
| Trinket| **Insignia of the Horde** (`horde`) | **Insignia of the Alliance** (`alliance`) | ✅ correct |
| Neck   | **Scout's Medallion** (⚠️ `both`) | **Sentinel's Medallion** (⚠️ `both`) | ⚠️ both tagged `both`; these are faction PvP rewards — verify & likely retag |
| Main-hand (hunter) | **Scout's Blade** (⚠️ missing) | **Sentinel's Blade** (`alliance`) | ⚠️ Horde mirror not authored (Horde builds use axe/Wingblade instead, so not a functional gap) |
| Quiver (hunter) | **Medium Quiver** (`both`, vendor) | **Quiver of the Night Watch** (`alliance`) | ✅ both used |
| Ammo pouch (hunter) | — (no green+ pouch) | **Bandolier of the Night Watch** (`alliance`) | ⚠️ authored but **orphaned** (never referenced) |

The remaining faction swaps in the Alliance builds are **shared "both" items** that need no
mirror — they just get selected by the Alliance build (e.g. Tunic of Westfall over Blackened
Defias Armor, Chausses of Westfall over Leggings of the Fang, Beetle Clasps over
Steel-clasped Bracers for mail wrists).

## Findings

### F1 — BUG: Alliance hunter build uses a Horde-only ring (must fix)

`gear/hunter.json` → `hunter-midfield-alliance` → `finger[0]` = `legionnaires-band`.
`legionnaires-band` is item-level `faction: "horde"` (Horde PvP rank reward). An Alliance
player cannot obtain it. The correct Alliance mirror is `protectors-band` — which the warrior
and rogue Alliance midfield builds already use.

- **Fix:** in `hunter-midfield-alliance`, `finger[0].item` → `protectors-band`.
- This is the *only* Horde-only-item leak into an Alliance build across all nine files
  (verified by grepping every `seal-of-sylvanas` / `insignia-of-the-horde` / `scouts-medallion`
  / `legionnaires-band` reference against its enclosing build).

### F2 — Mistag: Protector's Band should be `alliance`, not `both`

`gear/index.json` `protectors-band` is tagged `faction: "both"`, but it is the Alliance PvP
rank ring — the direct mirror of the Horde-tagged `legionnaires-band`. Leaving it `both` means
a Horde build could legally reference it and the F4 guard below wouldn't catch a future mistake.

- **Fix:** retag `protectors-band` → `alliance` (after Wowhead confirmation of the exact item).

### F3 — Verify & likely retag the PvP neck pair

`scouts-medallion` and `sentinels-medallion` are both `faction: "both"`, yet every build uses
them as a strict faction pair (Horde builds → Scout's, Alliance builds → Sentinel's). If these
are the faction-specific PvP reward necks (as their usage implies), they should be `horde` /
`alliance` respectively for consistency with the Seal and Insignia pairs.

- **Action:** confirm the source/faction on Wowhead Classic (ids not yet backfilled — see O1),
  then retag. If they are genuinely faction-neutral world drops, leave `both` and add a note
  explaining the intentional pairing. **Do not retag on assumption.**

### F4 — Orphaned item: Bandolier of the Night Watch

`gear/hunter.json` defines `bandolier-of-the-night-watch` (Alliance ammo pouch, +11% ranged
haste, item=3604) but **no build references it**. The Alliance hunter builds fill `ammo` with
`sharp-arrow` and `quiver` with `quiver-of-the-night-watch`. Per `09-bis-reference.md`, the
bandolier is a real Alliance-side advantage (Horde hunters lack a green+ pouch).

- **Decision needed:** either (a) wire the bandolier into the Alliance hunter builds' `ammo`
  slot as the pouch pick, or (b) remove the orphan to keep the registry clean. Recommend (a) —
  it's the accurate Alliance BiS and documents the faction asymmetry.

### F5 — "Horde-only circumstance" items tagged `both` (source/faction drift)

Several `both`-tagged items are actually obtained through faction-gated *quests or territory*.
They are functionally fine when only the matching faction's builds use them, but the tags don't
reflect the real source. Classify and, where a build of the *other* faction references them,
resolve:

| Item | Tagged | Real source | Faction reality | Impact |
|------|--------|-------------|-----------------|--------|
| `night-watch-shortsword` | both | Duskwood quest (Alliance zone) | Alliance-leaning | Used by Alliance-only paladin — fine; consider retag `alliance` |
| `jutebraid-gloves` | both | Horde quest (Mor'shan Rampart, Barrens) | Horde-only source | Used by Horde-only shaman — fine; consider retag `horde` |
| `tunic-of-westfall` / `chausses-of-westfall` | both | Deadmines / Westfall (Alliance territory) | Dungeon drops → obtainable by both | Leave `both` (Horde can run Deadmines) |
| `leggings-of-the-fang` / `cobrahns-grasp` / `venomstrike` / `wingblade` | both | Wailing Caverns (Barrens, neutral dungeon) | Obtainable by both | Leave `both` |
| `talbar-mantle` / `advisors-ring` / `viridian-band` / `lorekeepers-ring` | both | Quest reward (faction unverified) | Unknown | Verify faction on Wowhead; retag if gated |

The two clear retags (`night-watch-shortsword` → alliance, `jutebraid-gloves` → horde) are
low-risk because only the matching single-faction class uses them; do them alongside the neck
retag once ids are confirmed.

### F6 — GAP: Glacial Stone and other weapon options not represented

Community feedback (and the user) flags **Glacial Stone** (item **5815**, two-hand mace) as a
strong caster/hybrid 2H for **Paladin and Warrior**. It is currently **absent from all content**
(`grep` for `glacial-stone` / `5815` → no matches). Paladin builds today run 1H + shield
(Night Watch Shortsword / Shadowfang); no 2H caster option is offered.

- **Action (research, then author):** verify Glacial Stone on Wowhead Classic — exact stats,
  required level (must be ≤19), slot, `+spell damage`/`intellect` budget, and **faction of its
  quest source** (the "Absent-Minded Prospector"/Darkshore-area chain is Alliance; confirm).
  If Alliance-gated, add it as an `alliance` item and offer it in the Paladin flag-carrier /
  holy-caster loadout and any Alliance warrior caster-hybrid variant. If it turns out ≤19 and
  neutral, tag `both`.
- Track any other weapon swaps the community raises the same way — one registry item + a build
  reference, no schema change.

## Per-class Alliance status

- **Warrior** — ✅ complete. Canonical faction swaps: Sentinel's Medallion, Seal of Wrynn +
  Protector's Band, Insignia of the Alliance, Beetle Clasps (mail wrist), Chausses of Westfall.
- **Hunter** — ⚠️ fix F1 (Protector's Band), decide F4 (bandolier). Otherwise complete, with the
  richest faction modelling (Sentinel's/Scout's Blade, Night Watch quiver).
- **Rogue / Druid / Mage / Priest / Warlock** — ✅ complete and clean; Alliance builds differ
  from Horde only by shared-slot faction picks (neck / rings / trinket) plus a few `both` swaps.
- **Shaman** — ✅ Horde-only class; no Alliance work. (Housekeeping: F5 `jutebraid-gloves` tag.)
- **Paladin** — ✅ Alliance-only class; no Horde work. **Candidate for F6 Glacial Stone** as a
  2H caster option. (Housekeeping: F5 `night-watch-shortsword` tag.)

## Recommended remediation sequence (all data-only unless noted)

1. **F1 fix** (hunter Alliance ring → Protector's Band). One-line data edit; highest priority
   because it ships an unobtainable item to Alliance hunters.
2. **F4 decision** (wire in or remove Bandolier of the Night Watch).
3. **Backfill ids + verify, then retag** (F2 Protector's Band → alliance; F3 neck pair; F5
   `night-watch-shortsword` / `jutebraid-gloves`). Gate on Wowhead confirmation — never retag
   on assumption (existing "don't fabricate" rule).
4. **F6 research + author Glacial Stone** (and any other flagged weapons) as new registry items
   + build references.
5. **Add a loader guard (code — its own approval):** in `src/content/store.js`, extend the gear
   referential guard so every build slot reference resolves to an item whose faction is `both`
   or equals the build's faction; `fail(strict, …)` otherwise. Add a test that a Horde item in
   an Alliance build fails validation (would have caught F1). This is the one non-data change
   and should land with F1 so the regression is locked out.

## Validation

- `npm test` after each data edit — the store's referential guard already fails the build if a
  slot references an unknown item id, so a typo can't ship.
- After the F4 guard lands, add `test/content/store.test.js` cases: (a) an Alliance build
  referencing a `horde` item fails; (b) a `both` item in either faction passes.
- Spot-check the rendered embeds via `/bis <class> build:<alliance build>` for hunter (F1) and
  paladin (F6) once authored.

## Open verification items (do not fabricate — backfill from Wowhead Classic)

- **O1** — `wowheadId` for `scouts-medallion` and `sentinels-medallion`, plus their true source
  and faction (drives F3).
- **O2** — `protectors-band` exact item id + confirmation it is the Alliance rank ring (drives F2).
- **O3** — `glacial-stone` (item 5815): stats, required level ≤19?, slot, spell-damage budget,
  and quest-source faction (drives F6).
- **O4** — Faction of `talbar-mantle`, `advisors-ring`, `viridian-band`, `lorekeepers-ring`
  quest sources (drives the F5 "unknown" rows).
- **O5** — `precisely-calibrated-boomstick` (hunter) already flagged in-file as **Requires
  Level 43 — unusable at 19**; unrelated to faction but should be resolved during the same pass
  (the chart entry is likely a mis-named item).

## Source note

Per `09-bis-reference.md`, the Horde chart was exported from the "E&T Phone Gnome" sheet
(Horde tab, Cowblackout et al.); the **Alliance tab was never exported** — the Alliance builds
in the store were authored from community knowledge and the Horde↔Alliance mirror logic above.
When the Alliance tab is exported, drop it in `plans/data-sources/` and reconcile against this
audit before treating the Alliance side as source-verified.
