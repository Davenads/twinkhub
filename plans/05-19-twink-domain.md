# Domain Reference — Level 19 Classic Era Twinking

Verified facts to **seed the content store** (`data/content/19/`) and to keep the commands
accurate. Sources listed at the bottom. **BiS specifics are meta-dependent** — re-verify
against Wowhead / Warcraft Tavern at authoring time; the structural facts below are stable.

---

## Game version target (READ FIRST — this scopes all content)

**All TwinkHub content targets the final, fully-unlocked state of WoW Classic Era.**

- **Flavor:** WoW **Classic Era** — the permanent, non-progressing pre-TBC servers (live
  client **patch 1.15.x**). This is where the modern 19 twink scene actually plays (the
  Sixty Upgrades `/era/` sets and XPOff Era guides we cite are all this flavor).
- **Content phase:** **post-Phase 6** — the original Classic phase rollout was
  P1 Molten Core/Onyxia → P2 Dire Maul/world bosses → P3 Blackwing Lair →
  P4 Zul'Gurub → P5 Ahn'Qiraj → **P6 Naxxramas**. We assume **everything through P6 is
  released**, i.e. **all pre-TBC content, itemization, enchants, and recipes exist**. There
  is no phase-gating to reason about.
- **What this means for a level-19 twink specifically:** phase-gating in Classic only ever
  affected level-60 raids/attunements, so for 19s the practical effect is simply *"assume
  every low-level BoE, world drop, dungeon blue, quest reward, and no-req enchant is
  obtainable, at final 1.15.x tuning."* Author to the finished game, never to a mid-progression
  snapshot.
- **Explicitly NOT targeted:**
  - **Season of Discovery (SoD)** — no runes, no SoD-only abilities/items. Different game.
  - **Classic Anniversary / fresh progression realms** — that phased-rollout world is the
    sibling `wow-timers` project's context, **not** TwinkHub's. Do not import phase-gated
    assumptions from there.
  - **The Burning Crusade (TBC)** and beyond — hard pre-TBC ceiling.

> Encoded in data as `meta.json.gameVersion` (see `03-data-model.md`) so the target is
> machine-checkable, not just prose. Every bracket (19/29/49) shares this same version target.

## The bracket

- **10–19 Warsong Gulch (WSG).** Level cap for the bracket is **19**; a character that
  reaches 20 leaves the bracket. WSG is the only battleground at this level.
- **No in-game XP-off toggle in Classic Era.** Unlike retail, Classic/Classic Era has **no
  NPC/toggle to freeze experience**. Battlegrounds award **no XP**, but **mob and quest XP
  can still push a character to 20**. Twinks therefore **manage XP manually**: stop turning
  in XP quests near the cap, avoid killing mobs that would ding them, and complete only
  gear-reward quests whose XP won't overflow. This is the single most important "rule" the
  `/xprules` command must convey — many newcomers assume a toggle exists.

## Class meta (tiers — for `classes/` + `/tierlist`)

Consensus backbone of the 19 meta:

- **Hunter — top tier.** Ranged burst + pet + survivability; often called the strongest in
  10–19. **Faction asymmetry:** Alliance hunters get green+ ammo pouches (Quiver /
  Bandolier of the Night Watch); **Horde lack green-or-better pouches** — a real mechanical
  disadvantage to record on the Horde hunter entry.
- **Rogue** — strong stealth burst, control (Blind/Sap), high skill ceiling.
- **Warrior** — Charge/Hamstring, strong flag carrier and duelist; Prot vs 2H change role.
- **Priest** — premier healer, dispels, Power Word: Shield; backbone of a premade.
- **Situational / spec-dependent:** **Druid** (excellent flag carrier; "force-cast" builds
  rated highly), **Paladin** (Alliance), **Shaman** (Horde), **Mage**, **Warlock**. These
  swing on team comp and player skill rather than being clearly top or bottom.

Record each as a `tier` (S/A/B/…) with a one-line rationale; note that tiers are **playstyle-
and comp-dependent**, so the `/tierlist` output should say so rather than present tiers as
absolute.

## Stat priorities (for class entries)

- **Agility** classes: Rogue, Hunter, Druid (cat), Shaman (enh) — AP + crit + dodge + armor.
- **Strength** classes: Warrior, Paladin.
- **Int / spell power / healing**: Priest, Mage, Warlock, resto/holy hybrids.
- **Stamina** is universally valued (survivability wins WSG).

## Stat scaling & formulas (for a bracket `scaling.json` + `/statweights`)

Concrete conversions at level 19 (from the in-depth 19s scaling guide — verify per class
at authoring). These let commands explain *why* a stat is prioritized, and back a future
stat-weight/optimizer feature.

- **Strength → Attack Power:** `1 STR = 2 AP` for Warrior, Paladin, Shaman, Druid (Bear);
  `1 STR = 1 AP` for everyone else. Block value: `20 STR = 1 block`.
- **Agility:** `1 AGI = 2 Armor` (all classes). Crit ≈ `0.07%–0.13% per AGI`
  (class-dependent). Dodge ≈ `0.13% per AGI` (Rogue ≈ `0.26%`). Hunter/Rogue: `+1 melee AP`
  per AGI; Hunter: `+2 ranged AP` per AGI.
- **Stamina:** `1 STA = 10 Health` (Tauren `10.5`). The meta targets **~1000+ HP for flag
  carriers**; the guide's conclusion is that **stamina effectively beats every other primary
  stat** in competitive play — survivability wins WSG.
- **Intellect:** `1 INT = 15 Mana` (Gnome `15.75`). Spell crit ≈ `0.058%–0.063% per INT`.
- **Spirit:** mana regen ≈ `0.2–0.25 per Spirit / 5s` (class-dependent); minor HP regen.
- **Derived formulas:**
  - Physical mitigation: `reduction% = Armor / (Armor + 2015)` (the low-level armor
    constant; do **not** reuse the level-60 constant).
  - Melee/ranged DPS from AP: `DPS = AP / 14`.
  - Spell scaling: each spell benefits from spell power by its **coefficient**; sub-level-20
    spells are penalized further. Full per-spell table + the penalty formula in **Spell
    power coefficients** below.
- **PvP hit caps:** melee/ranged **5%**; spells **3%** (4% base miss minus talents). Note
  these when recommending hit-itemization vs raw stats.

> Store these as a per-bracket `scaling.json` (constants + per-class overrides) so the
> numbers live in data, not code, and shift cleanly for 29/49.

### Spell power coefficients (for `spellcoefficients.json` + `/spellcoef`)

Casters and hybrids benefit from spell power by a per-spell **coefficient**. At 19 these are
small — both because low-rank spells have short cast times and because of a hard low-level
penalty — which is *why* raw spell power is worth less here than stamina/survivability.

- **Base coefficient (standard vanilla rule):** direct damage/heal ≈ `castTime / 3.5` (with a
  **1.5s cast-time floor** for scaling); DoT/HoT ≈ `duration / 15`, applied **per tick**;
  instant procs (weapon/shield/orb) use their own reduced factor.
- **Sub-level-20 penalty (the twink-specific part):** a spell **learned at level X < 20**
  benefits `3.75% * (20 - X)` **less** from spell power. A spell learned at 4 therefore loses
  `3.75% * 16 = 60%` of its spell-power benefit. This stacks on top of the base coefficient.
- **Store the level-19-effective coefficient per spell rank** (the community list already
  gives values reduced for level 19). Group each entry by `type`: `direct-damage | dot |
  direct-heal | hot | shield | proc`. For `dot | hot | proc`, the coefficient is **per tick /
  per hit / per orb**, not per cast.

Representative level-19 values (from the XPOff coefficient list — verify each at authoring):

| Class | Spell (rank) | Coeff | Type |
|---|---|---|---|
| Mage | Frostbolt (3) | 0.463 | direct-damage |
| Mage | Fireball (4) | 0.793 | direct-damage |
| Mage | Fireball (DoT) | 0 | dot (no scaling) |
| Warlock | Shadow Bolt (3) | 0.56 | direct-damage |
| Warlock | Corruption (2) | 0.155/tick | dot |
| Priest | Lesser Heal (3) | 0.446 | direct-heal |
| Priest | Shadow Word: Pain (3) | 0.154/tick | dot |
| Shaman | Lightning Bolt (3) | 0.554 | direct-damage |
| Druid | Wrath (3) | 0.443 | direct-damage |
| Hunter | Serpent Sting (3) | 0.185/tick | dot |
| Paladin | Holy Light (3) | 0.554 | direct-heal |

**Verify-at-authoring flags:** several source entries are **not Wowhead-confirmed** (Paladin
Holy Light / Judgement of Righteousness, Power Word: Shield, Flametongue Weapon) and a few are
**TBD/unconfirmed** (Arcane Missiles, Fire Nova Totem, Searing Totem, Life Tap R1) — mark these
`confirmed: false` in data and never present them as authoritative. Also confirm whether a
given source value is **raw** or already **level-19-effective** before storing.

> Lives in a per-bracket **`spellcoefficients.json`** (penalty constant + per-class spell
> table), surfaced by a caster-facing **`/spellcoef`** command — the spell-power counterpart
> to `/statweights` (which covers melee / primary-stat scaling). Melee-only classes
> (warrior, rogue) have no entry.

## Universal slot picks (representative — verify each at authoring)

A cross-class starting frame from the jamesb gearing guide. Treat as **seed examples**, not
gospel — validate item names, faction availability, and current-meta status per entry.

- **Head:** Green Tinted Goggles (Engineering) or Lucky Fishing Hat. (Reminder: **no head
  enchant exists at 19** — do not model a Libram head enchant here; Librams require ~50.)
- **Neck:** Sentinel's Medallion.
- **Shoulders:** Talbar Mantle (quest reward).
- **Cloak:** Sentry Cloak / Engineer's Cloak, or a resistance cloak by matchup.
- **Boots:** Feet of the Lynx or Trailblazer Boots — **movement speed** is highly valued,
  especially for flag carriers.
- **Rings:** faction seals (Seal of Wrynn / Seal of Sylvanas) paired with stat rings
  (e.g. Viridian Band, Blood Ring).
- **Trinkets:** Insignia of the Alliance/Horde (PvP) paired with Minor Recombobulator
  (Engineering) or the **Arena Grand Master** trinket (Gurubashi Arena — ties into the AGM
  event this bot also tracks).

## Hunter pets & XP management (for a `pets` model + `/pets`, and `/xprules`)

Hunters are the top class *and* the most XP-management-intensive (pets must be leveled
without dinging the character). From the hunter pets/XP mini-guide:

- **Pet XP is cheap:** a pet needs **~25% of the XP a player needs** at the same level, so
  pets are levelable within a 19 character's XP budget.
- **Pets get NO XP from quest turn-ins** — only the player does. So do XP quests only after
  pets are synced to your level, or you'll out-level your pets.
- **The optimal trio (utility by matchup):**
  - **Boar** (e.g. Great Goretusk) → **Charge** utility.
  - **Cat** (e.g. The Rake) → fastest **1.2 attack speed**, pushes back casters.
  - **Wind Serpent** (e.g. Deviate Stinglash) → **ranged nature damage**, good vs plate/casters.
- **Ability shopping while taming:** tame temporary pets to learn ranks (Bite Rank 3, Claw
  Rank 3) before taming the keeper — abilities persist on the hunter's known list.
- **XP budgeting:** at level 18 with three level-18 pets you have roughly a **~6,000 XP
  surplus** to spend on the few required gear quests before hitting 19. Sync pets first,
  then turn in.
- **Required gear quests (faction-specific, mind the XP):** Alliance — *The Night Watch*
  (Quiver reward); Horde — Shadowfang Keep ring + Screecher Belt. For unavoidable mob XP,
  run **"ghost mode"** trailing higher-level players to minimize kills.

Model pets as a small per-class extra (e.g. `19/classes/hunter.json → pets[]` or a dedicated
`19/pets.json`): `{ family, exampleName, keyAbility, tameLevel, zone, notes }`.

## Enchants — the cornerstone mechanic

**Twinking hinges on enchants with no level requirement.** An enchant that ignores the
item's level requirement lets a level-19 character carry effects far above the bracket's
"natural" power. Flag these with `noLevelReq: true` in `enchants.json`.

High-value examples (verify exact values at authoring):
- **Enchant Weapon — Fiery Weapon** — chance on hit for **+40 Fire damage**. The iconic
  melee twink weapon enchant; no level requirement.
- **Crusader** (chance on hit: +100 Strength for 15s) and **Icy Chill** (chance on hit:
  slow) — other chance-on-hit melee options.
- **+15 Agility** / **+22 Intellect** weapon enchants — flat stat sticks for agi/caster.
- Standard slot enchants (bracer/gloves/chest/cloak) chosen per class's stat priority.
- **Head slot has no enchant at this bracket** — which is *why* Engineering goggles matter
  (below). Record this in `19/meta.json` notes.

## Professions

- **Engineering is near-universal.** **Green Tinted Goggles** (crafted) is a de-facto BiS
  head for many specs, since there's no head enchant at 19. Engineering also grants combat
  utility: **Heavy Dynamite**, explosive items, **Minor Recombobulator** (removes
  polymorph/some effects). Alternative head: **Lucky Fishing Hat** (harder to obtain).
- Other professions (Alchemy for potions, Enchanting for one's own enchants) are supporting
  picks; Engineering is the standout for combat impact.

## Consumables (for `consumables.json`)

- **Potions:** healing / mana potions on cooldown; some non-potion heals (e.g. **Green Tea
  Leaf**) do **not** share the potion cooldown and can be stacked around a potion for extra
  effective healing.
- **Poisons (Rogue):** e.g. **Venomhide Poison** — long duration, stacking damage per tick,
  a meaningful DPS add.
- **Food buffs, scrolls, oils, explosives, and world buffs** where available — model each
  with a `type` so `/consumable type:<x>` filters cleanly.

## WSG reputation & PvP rewards

- **Reputation vendors:** **Illiyana Moonblaze** (Alliance) / **Kelm Hargunth** (Horde).
  **Honored** with Warsong Outriders/Silverwing Sentinels unlocks purchasable gear — a
  reliable, non-RNG BiS source; mark these items `source.type: "pvp"`/`"vendor"`.
- **Faction medallion / PvP trinket** — purchasable with **Marks of Honor + honor**; a
  strong trinket slot pick (watch its level requirement vs the enchant "no-req" trick,
  which does not apply to item level requirements themselves).

## Faction asymmetry checklist (model on every relevant item)

- Alliance vs Horde have **different quests, vendors, and racials**. Notable: Horde hunters
  lacking green+ ammo pouches; different rep vendor NPCs; different zone quests for gear.
  Always set `faction` per item rather than assuming mirrored availability.

---

## Sources (seed set — expand & cite per item at authoring)

- Wowhead — Classic Level 19 Twink class guides & BiS hub:
  https://www.wowhead.com/classic/news/wow-classic-level-19-twink-class-guides-and-bis-gear-291929
- Wowhead — Classic Level 19 Twink Rogue BiS:
  https://www.wowhead.com/classic/guide/rogue-classic-level-19-twink
- Wowhead — Classic Level 19 Warrior Twink BiS:
  https://www.wowhead.com/classic/guide/warrior-classic-level-19-twink
- Warcraft Tavern — Twinking guide & BiS tool:
  https://www.warcrafttavern.com/wow-classic/guides/twinking/
- Warcraft Tavern — 19 Twink Hunter guide:
  https://www.warcrafttavern.com/wow-classic/guides/19-twink-hunter/
- Wowhead — Enchant Weapon: Fiery Weapon:
  https://www.wowhead.com/classic/spell=13898/enchant-weapon-fiery-weapon
- Vanilla WoW Wiki — Level 19 twink:
  https://vanilla-wow-archive.fandom.com/wiki/Level_19_twink
- XPOff — Classic lvl 19 Twink tier list (community):
  https://xpoff.com/threads/classic-lvl-19-twink-tier-list.88756/
- XPOff — jamesb's 19 vanilla gearing guide (slot-by-slot):
  https://xpoff.com/threads/jamesbs-19-vanilla-gearing-guide.83959/
- XPOff — In-depth stat guide for 19s with scaling formulas:
  https://xpoff.com/threads/in-depth-stat-guide-for-19s-with-scaling-formulas.93237/
- XPOff — Spell power coefficient list for all level-19 spells:
  https://xpoff.com/threads/spell-power-coefficient-list-for-all-level-19-spells.93250/
- XPOff — Hunters: pets and leveling / XP management mini-guide:
  https://xpoff.com/threads/hunters-pets-and-leveling-xp-management-mini-guide.90695/
- Sixty Upgrades (Era) — gearset planner; example shared set:
  https://sixtyupgrades.com/era/character/mXUUWjcJVo86ducbwPAAwT/set/7b7coWL6PtuoSuhgbXrFBr

### Sixty Upgrades as a gearset reference

[Sixty Upgrades](https://sixtyupgrades.com) is a web app for building a character's gearset
slot-by-slot (items + enchants), producing a **shareable URL** per saved set (as in the
example above). It's the de-facto way the community shares 19 loadouts. We use it two ways:
(1) attach a canonical `sixtyupgradesUrl` to each class's recommended set so `/bis`/`/gear`
can link "see the full interactive set"; (2) as an **authoring source** — cross-check our
per-slot data against community sets. The page is a JS SPA (content isn't in raw HTML), so
treat these as human-curated links, not scrape targets.

> **Caveat:** BiS lists, tier placements, and exact enchant values drift with the meta and
> patch. The store is the living source of truth; this doc is the seed + the *stable* rules
> (bracket cap, no XP-off, enchant-no-req mechanic, Engineering goggles, WSG rep vendors,
> faction asymmetry).
