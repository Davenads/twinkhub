# Talent Builds (`/talents` + panel surface)

A per-class catalogue of **PvP talent builds** for the bracket: for each class, a short
list of viable point allocations with their effect summary, an emoji-decorated node
breakdown, and a Wowhead talent-calc link. Delivered as a `/talents` slash command **and**
a panel follow-up — both driven by the **same render service** (the non-negotiable rule
from `08-enduser-panels.md`). All game knowledge lives in the content store, never in code.

Source of truth for the initial 19 dataset: the community `19 Class Talents` doc
(Wowhead `talent-calc/embed` links + effect notes + point allocations). 9 classes, ~25
builds total.

---

## Why talents fit the existing "class build" model

Talents are just another **per-class, multi-variant build list**, structurally identical to
BiS role builds (`gear/<class>.json` → `builds[]`) and spell coefficients
(`spellcoefficients.json` → `byClass`). So this feature reuses three established patterns
wholesale:

1. **Optional per-bracket content file** loaded in `loadBracket` with a referential guard
   (mirrors `spellcoefficients.json` / `pets.json`, `store.js:405-439`).
2. **A render service** `renderTalents({ store, bracket, className, build })` shaped like
   `renderSpellcoef` / `renderBis` — degrade-safe, content-only copy.
3. **A slash command + a panel follow-up button** that both call that one service, exactly
   like `/spellcoef` ↔ the `scoef` panel action.

The only genuinely new capability is **custom emoji rendering**, which needs a small,
shared registry (below). Everything else is a copy of what already ships.

---

## Emoji: the one new subsystem

### What we have
- **57 talent-node emojis** + **9 class-icon emojis** uploaded as **application emojis**
  (attached to the bot app). Application emojis render in every guild the bot is in with the
  markup `<:name:id>` (`<a:name:id>` if animated) — no per-guild upload, no `GuildEmojis`
  intent. This is why they work inside the cross-guild persistent panels.

### Reading the IDs (one-time bootstrap)
There is **no way to read these from source** — they live on Discord. The running bot reads
them via discord.js 14.16's `ApplicationEmojiManager`:

```js
// scripts/list-emojis.js  (dev-only, run once)
const list = await client.application.emojis.fetch();
for (const e of list.values()) console.log(`${e.name}\t${e.id}\t${e.animated ? 'a' : ''}`);
```

Add an npm script `"emojis:list": "node scripts/list-emojis.js"`. Run it once, paste the
`name → id` output into the registry file (below). Re-run only when emojis are added/renamed.
Secrets stay in `.env`; the script logs in with the existing token and exits after fetch.

### Naming convention (do this in the Dev Portal before dumping)
Deterministic slugs make the registry auto-derivable and the JSON authorable by hand:
- **Class icons:** `class_<class>` — `class_druid`, `class_hunter`, … (9).
- **Talent nodes:** `t19_<class>_<talent-slug>` — e.g. `t19_druid_natures_grasp`,
  `t19_priest_blackout`, `t19_warrior_deflection`. Slug = talent name lowercased, spaces →
  `-`/`_`, punctuation dropped.

Because node emojis are namespaced per class, two classes can both have a "Precision"
node without collision (`t19_rogue_precision` vs `t19_paladin_precision`).

### The registry (shared, bracket-agnostic)
`data/content/emoji.json`, loaded once at store root (beside `index.json`), so both the
talents feature **and** the Class Builds panel's per-class select icons draw from it:

```json
{
  "note": "Application-emoji registry. Regenerate ids with `npm run emojis:list`.",
  "classes": {
    "druid":  { "name": "class_druid",  "id": "000000000000000000" },
    "hunter": { "name": "class_hunter", "id": "000000000000000000" }
  },
  "nodes": {
    "t19_druid_natures_grasp":       { "name": "t19_druid_natures_grasp",       "id": "…" },
    "t19_druid_natural_shapeshifter":{ "name": "t19_druid_natural_shapeshifter","id": "…" }
  }
}
```

Accessor `emojiMarkup(store, slug) -> "<:name:id>" | ""`:
- returns `""` (empty string, never a broken `<::>`) when a slug is missing, so a not-yet-
  filled ID **degrades to text-only** instead of erroring — the same fail-soft philosophy as
  `metaFooter`/`degradeEmbed`.
- animated flag optional: `emoji.animated === true` → prefix `a`.

---

## Content model — `data/content/19/talents.json`

Mirror of `spellcoefficients.json`: a `byClass` map keyed by roster class. Each class holds
an ordered `builds[]`. A build is deliberately close to a **BiS build** shape (`id`, `name`,
optional `role`/`faction`/`default`) so the panel's build-switcher pattern (see
`11-bis-alliance-faction-audit.md` follow-on) can be reused verbatim later.

```json
{
  "note": "Level-19 WSG PvP talent builds. Node point-caps reflect the 19 point budget.",
  "credit": { "source": "19 Class Talents (community doc)", "author": null, "discordId": null },
  "byClass": {
    "druid": [
      {
        "id": "druid-grasp-shifter",
        "name": "Nature's Grasp / Shapeshifter",
        "role": "flag-carrier",
        "default": true,
        "summary": "100% proc Nature's Grasp; 40% rage-on-shift (Furor); strong shapeshift uptime.",
        "points": "5/5 Nature's Grasp, 3/3 Natural Shapeshifter, 2 Furor",
        "url": "https://www.wowhead.com/classic/talent-calc/embed/druid/0140003--02",
        "nodes": [
          { "talent": "Nature's Grasp",      "rank": 5, "max": 5, "emoji": "t19_druid_natures_grasp" },
          { "talent": "Natural Shapeshifter","rank": 3, "max": 3, "emoji": "t19_druid_natural_shapeshifter" },
          { "talent": "Furor",               "rank": 2, "max": 5, "emoji": "t19_druid_furor" }
        ]
      }
    ]
  }
}
```

Field notes:
- `summary` = the doc's effect blurb (what the build *does* in a fight). `points` = the raw
  allocation string (authoritative, human-readable). `url` = the embed link, rendered as a
  masked link `[Open in Wowhead](url)`.
- `nodes[]` powers the emoji row and is the join key into the emoji registry. `rank`/`max`
  render as `2/5`. Order = display order.
- `role`/`faction`/`default` are **optional** and only meaningful where the doc distinguishes
  them; most 19 talent builds are faction-agnostic, so `faction` is usually omitted.

### Referential validation (new `validateTalents` + loader guard)
Loader block in `loadBracket`, copied from the spellcoef guard (`store.js:421-439`):
- every `byClass` key must be a roster class (fail loud in strict/dev otherwise);
- every `builds[].id` unique within its class;
- every `nodes[].emoji` slug must exist in `emoji.json#nodes` (catches typos / un-dumped
  ids at boot — the same "fail loud in dev" contract as the rest of the store);
- `url` must match the `wowhead.com/classic/talent-calc/embed/` prefix (cheap sanity guard).

Add `validateTalents(file, ctx)` to `schema.js` beside `validateSpellCoefficients`, and load
`emoji.json` with its own `validateEmojiRegistry` at store root.

### Store accessors (mirror the spellcoef trio)
```
bracketTalents(store, bracket)              -> { note, credit, byClass } | null
talentsForClass(store, bracket, className)  -> builds[] | null
listTalentClasses(store, bracket)           -> classKeys[]        // for autocomplete
emojiMarkup(store, slug)                     -> "<:name:id>" | ""
```

---

## Render service — `src/services/talents.js`

`renderTalents({ store, bracket, className, build = null }) -> { embeds }`, shaped on
`renderSpellcoef` (`services/spellcoef.js`):

- **No talents for bracket** → degrade `"No talent data is loaded for bracket 19."`
- **Class not authored** → if it's a roster class, `"No talent builds authored for X yet."`;
  otherwise the generic unknown-class degrade.
- **No `build` arg (default view)** → one embed listing **all** of the class's builds (they're
  short — ≤4 per class), one field per build:
  - field name: `{classEmoji} {build.name}` (class icon via `emojiMarkup`).
  - field value: the emoji node row `<:a:><:b:> 5/5 Nature's Grasp · 3/3 Natural Shapeshifter`,
    then the `summary`, then `[Open in Wowhead](url)`.
  - Fits comfortably under the 25-field / 6000-char embed caps given ≤4 builds; reuse
    `fieldsFromLines` if any single build's node list overruns 1024 chars.
- **`build` arg** → narrow to that one build with the full per-node breakdown (each node its
  own line with emoji + `rank/max` + talent name), for deep detail / the panel switcher.
- Title via `metaTitle`, footer via `metaFooter`, `credit` line in the description exactly
  like `renderSpellcoef`. Reply always with `allowedMentions: { parse: [] }`.

Emoji is **decorative only** — every line is fully legible with the emoji stripped, so a
missing ID (`emojiMarkup` → `""`) just yields clean text.

---

## Slash command — `src/commands/data/talents.js`

Copy of `spellcoef.js` with an optional `build` option (like `/bis`):

```
/talents class:<class> [build:<build>]
```
- `class` (required, autocomplete → `listTalentClasses`).
- `build` (optional, autocomplete → the chosen class's `builds` by `id`, labelled by `name`).
- `execute` → `renderTalents(...)` → `interaction.reply`.

New command definition ⇒ **`npm run deploy`** once (per CLAUDE.md, deploy only when a
command's name/options/description change).

---

## Panel integration (the emphasis of this request)

Talents attach to a **class**, so the natural, minimal, architecture-consistent home is a
**follow-up button on the BiS ephemeral result** — identical to how `Enchants`,
`Consumables`, `Stat Weights`, `Spell Scaling`, and `Pets` already hang off `bisFollowups`
(`services/panels.js:193`). No new public panel is required.

### Flow
1. Class Builds panel select (`p1|pick|bis`) → ephemeral `renderBis`.
2. That result now carries a **`Talents`** button → `p1|talents|<class>`.
3. Router action `talents` → `renderTalents({ className })` → ephemeral all-builds view.
4. *(Optional, phase 2)* the talents view carries a **build-select** `p1|talv|<class>`
   (chosen build id in `values[0]`) that re-renders in place with `interaction.update` to the
   single-build detail view — the exact pattern recommended for the BiS role/faction switcher
   in `11-…-audit.md`. Reuses `buildsForClass`-style listing; ≤4 options per class.

### customId contract (unchanged grammar, `08-enduser-panels.md`)
- `p1|talents|hunter` — 15 chars, far under the 100-char cap; slug-only; versioned.
- `p1|talv|hunter` — build-switch select; build id travels in `values[0]`, not the id.
- New router entries in `components/panels.js` `HANDLERS`:
  ```js
  talents: (i, ctx, [cls]) => reply(i, renderTalents({ ...ctx, className: cls })),
  talv:    (i, ctx, [cls]) => updateTalents(i, ctx, cls, i.values?.[0]),
  ```
- Add the `Talents` button to `bisFollowups` (one more `ButtonBuilder`, still ≤5 per row —
  current followups are ≤5, so it may push to a second row for casters/hunter; both allowed).

### Emoji on the class select (bonus, already anticipated)
`08-enduser-panels.md` §Panel catalogue #1 explicitly wanted the class picker "with per-class
emoji." Now that we have `emoji.json#classes`, set each `StringSelectMenuOption.emoji =
{ id, name }` in `buildClassBuildsPanel`. Requires a `/panels refresh` (option set changes),
not a redeploy.

### Why not a modal / a new panel
Talent build is a **bounded, enumerable arg** straight from the store, so per
`08-enduser-panels.md` §"modal vs. component chaining" it is a select/button case, never a
modal. And a dedicated top-level "Talents" panel would duplicate the class picker that Class
Builds already owns — folding talents into the class result keeps one class entry point.

---

## Authoring checklist (initial 19 dataset)

Builds to author from the source doc (flag any gaps for research before shipping):

| Class | Builds | Notes |
| --- | --- | --- |
| Druid | 3 | Grasp/Shifter, Full Grasp+Furor, Grasp+Imp. Entangling Roots |
| Hunter | 4 | Deflection/Wing-Clip, Concussive-stun, Imp.Concussive+Lethal, Aspect-of-Hawk proc — **build #2 has no point-allocation line in the doc; derive it from the calc URL `-2-032003`** |
| Mage | 4 | Frost (root-proc), Frost (Imp. Frost Nova), Fire, Arcane-Missiles |
| Paladin | 2 | Redoubt/Toughness, Redoubt/Precision (Alliance) |
| Priest | 4 | Blackout/Renew, Unbreakable-Will/Martyrdom, Divine-Fury heal, Wand/Blackout |
| Rogue | 2 | Imp.Gouge/Precision, Imp.Gouge/MoD/Camouflage |
| Shaman | 3 | Convection/Earth's-Grasp, Concussion/Earth's-Grasp, Convection/Imp.Healing-Wave |
| Warlock | 1 | Imp.Corruption/Life-Tap/Healthstone |
| Warrior | 2 | Deflection/Charge/Tactical-Mastery, Anticipation/Iron-Will |

- Give each build a stable `id` slug and a short `name` (≤~40 chars for the select option).
- Enumerate every node named in the `points` line into `nodes[]`; those names define the set
  of node-emoji slugs the Dev-Portal upload must cover (the "57" should map 1:1 — reconcile
  during authoring and list any missing/extra).

---

## Rollout / ops checklist

1. Dev Portal: rename uploaded emojis to the `class_*` / `t19_*` convention.
2. `npm run emojis:list` → paste ids into `data/content/emoji.json`.
3. Author `data/content/19/talents.json` (table above).
4. Add `validateEmojiRegistry` + `validateTalents` (`schema.js`); load both in the store
   (`emoji.json` at root, `talents.json` in `loadBracket`); add the four accessors.
5. Add `services/talents.js`; add `commands/data/talents.js`.
6. Add `Talents` button to `bisFollowups`; add `talents` (+ optional `talv`) router actions;
   set class-select emojis in `buildClassBuildsPanel`.
7. `npm test` (validators + render degrade + `emojiMarkup` fallback).
8. `npm run deploy` (new `/talents` command), `pm2 reload twinkhub`, then
   `/panels refresh` (new followup button + class-select emojis).

## Tests to add (`node --test`)
- `validateTalents` accepts the sample, rejects: unknown class key, dup build id, node emoji
  slug absent from registry, non-embed `url`.
- Store loader: strict mode fails on a talents file referencing a non-roster class.
- `renderTalents` degrades cleanly for an unauthored class and a bracket with no talents.
- `emojiMarkup` returns `""` for an unknown slug (fail-soft) and correct `<:name:id>` /
  `<a:name:id>` otherwise.

## Non-goals / guardrails
- No talent *calculator* / point editor — this is a curated read, same as BiS.
- Emoji is strictly decorative; every embed must be fully legible with emoji stripped.
- customIds stay ≤100 chars, slug-only, `p1`-versioned; build ids ride in `values[0]`.
- Content stays in JSON; labels/options generated from the store; handlers stay thin.

## Open decisions (need a call before build)
1. **Default panel view:** all-builds-in-one-embed (recommended — talent builds are short) vs.
   default to the `default:true` build + a switcher. Recommendation: all-builds default; add
   the `talv` single-build switcher only if fields get cramped.
2. **Emoji registry location:** shared `data/content/emoji.json` (recommended — the class
   icons are reused by the Class Builds panel) vs. an `emoji` block inside `talents.json`.
3. **Faction on talent builds:** the doc mostly ignores it; keep `faction` optional and omit
   unless a build is genuinely faction-specific (e.g. Alliance Paladin).
