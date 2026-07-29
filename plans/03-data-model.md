# Data / Content Model

The data commands are only as good as the content store behind them. This is the spine of
TwinkHub. **Content is authored data, not code** — adding a BiS item, an enchant, or a
guide is a JSON edit + validation, never a code change.

Learned lesson (carried from the sibling case-data project): **modularize before the schema
grows.** Do not put all knowledge in one giant `content.json`. Split by bracket → domain →
class from the start so files stay small, diff-friendly, and expandable.

## Directory layout

```
data/content/
├── index.json                       # registry: brackets present, schema version
├── 19/                              # bracket namespace (first shipped)
│   ├── meta.json                    # bracket rules: level cap, xp rules, WSG info
│   ├── classes/
│   │   ├── index.json               # class list + tier ratings for this bracket
│   │   ├── hunter.json              # per-class: spec(s), stat priority, notes
│   │   ├── rogue.json
│   │   └── …                        # one per class
│   ├── gear/
│   │   ├── index.json               # slot list, shared/BoE items
│   │   ├── hunter.json              # BiS by slot, per class (+ faction variants)
│   │   └── …
│   ├── enchants.json                # enchants usable at this bracket (no-req flagged)
│   ├── consumables.json             # potions, poisons, food, explosives, world buffs
│   ├── quests.json                  # gear-reward quests worth doing before the cap
│   ├── scaling.json                 # stat conversion constants + per-class overrides
│   ├── spellcoefficients.json       # caster spell power coefficients + sub-20 penalty
│   ├── pets.json                    # hunter pet families/abilities (class-extra data)
│   ├── sets.json                    # curated per-class Sixty Upgrades set links
│   └── guides/
│       ├── index.json               # guide slugs + titles + summaries
│       └── <slug>.md or .json       # long-form curated guides
├── 29/ …                            # future brackets, same shape (see 06)
└── 49/ …
```

Every bracket folder has the **same internal shape**, so the loader is bracket-agnostic and
expansion is pure copy-the-shape-and-fill-data.

## Loader & validation

- `content/store.js` walks `data/content/`, loads every bracket present in `index.json`,
  validates each file against `content/schema.js` (**zod** or **ajv**) **on boot**, and
  builds in-memory indexes: by bracket, by class, by slot, by item name (for autocomplete).
- **Fail loud on invalid content at boot** in dev; in prod, skip the bad file, log an
  error, and keep serving the rest. Never crash the bot over one malformed guide.
- Hot-reload (implemented): the dev `/reloadcontent` command re-reads and re-validates the
  store without a restart (strict reload; keeps the last-good store on error), for fast
  content authoring.

## Core schemas (v1 draft — refine at build time)

### `<bracket>/meta.json`
```json
{
  "bracket": "19",
  "gameVersion": {
    "flavor": "classic-era",
    "phase": 6,
    "contentState": "all-pre-tbc-unlocked",
    "clientPatch": "1.15.x",
    "note": "Final Classic Era state — post-Phase 6 (Naxxramas released); all pre-TBC items, enchants, and recipes available. NOT SoD, NOT Anniversary progression, NOT TBC. Same value across all brackets."
  },
  "levelRange": [10, 19],
  "levelCap": 19,
  "battleground": "Warsong Gulch",
  "xpLock": {
    "available": false,
    "note": "Classic Era has no in-game XP-off toggle. XP must be managed manually; BGs award no XP, but mob/quest XP can ding you past 19."
  },
  "repVendors": {
    "alliance": "Illiyana Moonblaze",
    "horde": "Kelm Hargunth",
    "honoredUnlock": true
  }
}
```

### item (used in `gear/*.json`)
```json
{
  "id": "green-tinted-goggles",
  "name": "Green Tinted Goggles",
  "slot": "head",
  "source": { "type": "profession", "detail": "Engineering (crafted)" },
  "faction": "both",
  "stats": { "agility": 6, "stamina": 6, "spirit": 6 },
  "reqLevel": 18,
  "notes": "De-facto BiS head for many specs; head has no enchant at this bracket.",
  "wowheadId": null,
  "priority": "core"
}
```
`source.type` ∈ `drop | quest | vendor | profession | pvp | world | boe`.
`faction` ∈ `alliance | horde | both`.
`priority` ∈ `core | situational | budget`.

### enchant (in `enchants.json`)
```json
{
  "id": "fiery-weapon",
  "name": "Enchant Weapon - Fiery Weapon",
  "slot": "weapon",
  "effect": "Chance on hit: +40 Fire damage.",
  "reqLevel": null,
  "noLevelReq": true,
  "notes": "Cornerstone melee twink enchant precisely because it has no level requirement.",
  "classes": ["warrior", "rogue", "hunter", "paladin", "shaman", "druid"]
}
```
`noLevelReq: true` is a **first-class flag** — the entire twink enchant meta hinges on
enchants that ignore the item's level requirement.

### consumable (in `consumables.json`) — backs `/consumable`
```json
{
  "id": "green-tea-leaf",
  "name": "Green Tea Leaf",
  "type": "food",
  "effect": "Off-cooldown heal that does NOT share the potion cooldown; stack around a healing potion for extra effective healing.",
  "faction": "both",
  "classes": ["rogue"],
  "reqLevel": null,
  "source": { "type": "vendor", "detail": "…" },
  "notes": "…"
}
```
`type` ∈ `potion | poison | food | explosive | worldbuff` (the same five `/consumable type:`
exposes). `classes` is **optional**: when present the consumable is class-specific (poisons →
`rogue`) and each entry must be a real roster class; when absent it applies to everyone.
`faction`/`reqLevel`/`source`/`notes` are optional so an item can be authored before every
detail is verified. Ids are unique bracket-wide.

### class (in `classes/*.json`)
```json
{
  "class": "hunter",
  "tier": "S",
  "roles": ["ranged-dps"],
  "specs": [{ "name": "Marksmanship-ish", "statPriority": ["agility","stamina","intellect"] }],
  "summary": "Top of the bracket: burst + survivability + range.",
  "factionNotes": "Alliance hunters get Quiver/Bandolier of the Night Watch; Horde lack green+ ammo pouches."
}
```

### quest (in `quests.json`) and guide (in `guides/`)
- quest: `{ id, name, zone, faction, reward: {itemId|desc}, xpWarning: bool, notes }`.
  `xpWarning` flags turn-ins that risk pushing a near-cap character to 20.
- guide: front-matter (`slug`, `title`, `summary`, `class?`, `tags[]`) + markdown body,
  rendered into embeds (chunked to Discord's field limits).

### scaling (in `scaling.json`) — backs `/statweights` + explains stat priority
Constants and per-class overrides so numbers live in data, not code (see
`05-19-twink-domain.md` for the level-19 values). Shape:
```json
{
  "constants": { "armorConstant": 2015, "apPerDps": 14, "hpPerSta": 10, "manaPerInt": 15,
                 "hitCap": { "meleeRanged": 5, "spell": 3 } },
  "perClass": {
    "warrior": { "apPerStr": 2 },
    "rogue":   { "apPerStr": 1, "critPerAgi": 0.10, "dodgePerAgi": 0.2633, "meleeApPerAgi": 1 },
    "hunter":  { "rangedApPerAgi": 2, "meleeApPerAgi": 1 }
  }
}
```
Use the **low-level** `armorConstant` (2015), not the level-60 value.

### spellCoefficients (in `spellcoefficients.json`) — backs `/spellcoef`
Level-19-effective spell power coefficients per caster/hybrid spell, plus the sub-level-20
penalty constant. It's a big per-class table, so it lives in its **own file**, not
`scaling.json`.
```json
{
  "penalty": {
    "perLevelBelow20": 0.0375,
    "note": "A spell learned at level X<20 benefits 3.75%*(20-X) less from spell power; the coefficients below are already level-19-effective."
  },
  "byClass": {
    "mage": [
      { "spell": "Frostbolt", "rank": 3, "coefficient": 0.463, "type": "direct-damage", "confirmed": true },
      { "spell": "Fireball", "rank": 1, "coefficient": 0, "type": "dot", "confirmed": true, "notes": "DoT component does not scale." }
    ],
    "priest": [
      { "spell": "Lesser Heal", "rank": 3, "coefficient": 0.446, "type": "direct-heal" }
    ],
    "paladin": [
      { "spell": "Holy Light", "rank": 3, "coefficient": 0.554, "type": "direct-heal", "confirmed": false }
    ]
  }
}
```
`type` ∈ `direct-damage | dot | direct-heal | hot | shield | proc`. For `dot | hot | proc`
the coefficient is **per tick / per hit / per orb**, not per cast. `confirmed: false` marks a
value not yet Wowhead-verified — the command must not present it as authoritative. Melee-only
classes (warrior, rogue) simply have **no key** here, and `/spellcoef` degrades cleanly for
them ("no spell scaling at 19").

### pets (in `pets.json`) — hunter class-extra, backs `/pets`
```json
{
  "class": "hunter",
  "families": [
    { "family": "boar", "exampleName": "Great Goretusk", "keyAbility": "Charge",
      "tameLevel": 16, "zone": "Redridge", "notes": "Utility charge/stun." },
    { "family": "cat", "exampleName": "The Rake", "keyAbility": "Claw",
      "attackSpeed": 1.2, "notes": "Fastest swing; pushes back casters." },
    { "family": "wind-serpent", "exampleName": "Deviate Stinglash", "keyAbility": "Lightning Breath",
      "tameLevel": 17, "zone": "Wailing Caverns", "notes": "Ranged nature dmg vs plate/casters." }
  ],
  "xpNote": "Pets need ~25% of player XP; pets gain NO XP from quest turn-ins. Sync pets to your level BEFORE turning in gear quests."
}
```

### sets (in `sets.json`) — curated Sixty Upgrades links per class/spec
```json
{
  "hunter": [
    { "label": "Ranged BiS", "faction": "alliance",
      "sixtyupgradesUrl": "https://sixtyupgrades.com/era/character/…/set/…",
      "notes": "Community-shared full loadout; source-of-truth cross-check." }
  ]
}
```
`/bis` and `/gear` surface the matching `sixtyupgradesUrl` as a "see the full interactive
set" link. These are **human-curated links**, not scraped — Sixty Upgrades is a JS SPA.

## Authoring & sourcing rules

- **Cite sources in the data.** Each gear/enchant entry may carry a `sourceRef` URL
  (Wowhead / Warcraft Tavern) so content is auditable and re-verifiable as the meta shifts.
- **BiS is meta- and patch-dependent.** Treat lists as living data; do not bake them into
  code. `05-19-twink-domain.md` holds the current verified facts to seed the store.
- **Author to the final Classic Era state** (`gameVersion` in `meta.json`: post-Phase 6 /
  Naxx, all pre-TBC content at patch 1.15.x). Do **not** enter SoD-only, Anniversary
  phase-gated, or TBC+ items/enchants — they're out of scope by definition.
- **Faction variants matter** (Alliance vs Horde have different vendor/quest access) — model
  `faction` on every item rather than assuming symmetry.
- Keep files **small and per-class** so two contributors editing different classes never
  collide in a diff.

## Validation gates (CI-later)

- Schema-validate all content files.
- Referential checks: every `itemId` referenced by a class/guide exists in gear; every
  `enchant.classes[]` is a real class; every `spellcoefficients.byClass` key is a real class;
  every `consumable.classes[]` is a real class; no duplicate `id`s within a bracket.
- Lint: every `core`-priority gear slot is filled per class (flag gaps).
- Game-version check: every bracket's `meta.json.gameVersion.flavor` is `classic-era` with
  `contentState: all-pre-tbc-unlocked` (guards against SoD/TBC/Anniversary content creeping in).
