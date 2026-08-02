# Embed Formatting Review & Component Roadmap

A reference audit of every slash command's returned embed, the cross-cutting
formatting issues, and a sequenced plan for tightening presentation and adding
buttons / pagination. Written after the enchant-hyperlink work; pairs with
`08-enduser-panels.md` (the P4 panel surface reuses the same render layer).

All render logic lives in `src/services/renderX({ store, bracket, ... }) -> { embeds }`.
Slash handlers stay thin; the same functions will back the P4 panels. Keep the
service layer the single source of truth for presentation — never format in a
command handler or a component handler.

---

## Strengths (keep these)

- **One brand color** `0xc8aa6e` used consistently across all embeds.
- **Consistent footer** convention: `WoW Classic Era <clientPatch>`, often with
  a second `·`-joined bit (page counter, unverified count).
- **Service/render split** already in place for all 14 data commands — the
  hardest architectural work is done.
- **Graceful degrade paths** everywhere (missing bracket, class, slug) return a
  clean titled embed with a helpful message rather than throwing.
- **Data honesty**: `_unverified_` spell coefficients, XP-risk flags on quests,
  "coming soon" on catalogued-but-unauthored guides.
- **Content-as-data**: all copy comes from the JSON store; labels/options are
  generated, never hardcoded.

---

## Cross-cutting issues

| # | Severity | Issue |
|---|----------|-------|
| C1 | **HIGH** | No shared 1024-char field-**value** guard. Only `guide.js` truncates. Any long authored field (stats blocks, source detail, enchant notes) risks a `400 Invalid Form Body` at runtime. |
| C2 | MED | No 6000-char embed-total guard, no empty-value guard (Discord rejects empty field values). Field-count is capped ad hoc per service (`MAX_FIELDS = 25`) but total length is not. |
| C3 | LOW | Inconsistent title meta-suffix: `enchant`/`consumable`/`guide` use `— {bg} {cap}`; `bis`/`spellcoef` use `({bg} {cap})`. Pick one. |
| C4 | LOW | Degrade / "not found" embeds use the success gold `0xc8aa6e`, reading like a normal result. Want a distinct (muted/red) color so an empty state is visually obvious. |
| C5 | MED | Replies are not deferred. Fine today (renders are sync + fast), but once a render does async work or panels add components it should `deferReply()` to stay within the 3s ack window. |
| C6 | LOW | `allowedMentions: { parse: [] }` is set on some command wrappers but should be guaranteed on every reply that echoes content-store text. |
| C7 | MED | Wowhead link coverage lags the data: only `/bis` and `/item` use the `wowhead` refs. `/gear` and `/enchant` still show plain names. |

### C1 — the field-value guard (highest value)

Promote `guide.js`'s local `truncate()` into a shared `src/lib/embed.js` and
route every `addFields({ value })` through a `fieldValue()` helper that:
- truncates to 1024 with an ellipsis,
- coerces empty/nullish to a single non-empty placeholder (`\u2014`),
so no service can emit a 400.

---

## Per-command notes

Legend for the "components" column — opportunities only, not yet built.

| Command | Formatting notes | Component / pagination opportunity |
|---------|------------------|-------------------------------------|
| `/bis` | Flagship. Build view = one field per slot, enchant linked. **Defect:** "Other builds" line lists all non-chosen builds across *both factions*, so a class with per-faction build pairs shows duplicate names (`Midfield, Defense, Offense, Midfield, Defense`). Fix: dedupe + filter to the chosen build's faction. | Related-data buttons: `Enchants`, `Consumables`, `Stat Weights`, `Spell Scaling`, `Pets` — each carrying the class. Build switch as a select. |
| `/class` | Overview embed (renderClass). | Same follow-up buttons as `/bis`. |
| `/item` | **Raw URL** dumped in a "Wowhead" field — ugly. Move to `embed.setURL()` on the title (clickable title). Alternatives listed as bold, unlinked. Enchant name already linked. | Button to jump to the item's `/bis` class, or list which builds use it. |
| `/enchant` | Enchant name is in the field **name** (not linkable) with a ` — no level req` suffix. Move the name into the value line so the Wowhead masked link renders; keep the no-level-req flag as its own prominent line. Caps at 25 fields with a "narrow your filter" note. | Slot select → re-render for that slot. Pagination if a slot ever exceeds 25. |
| `/consumable` | One field per consumable, grouped by type order, 25 cap with overflow note. Clean. | Type buttons (`Potions`, `Poisons`, `Food`, `Explosives`, `World Buffs`). Pagination for long lists. |
| `/gear` | Flat grouped-by-slot view via `slotFields`. Item names linked; enchant shown as generic `_enchant, N alts_` marker. | Slot select; per-item detail button. |
| `/statweights` | Compact. | Class follow-up buttons. |
| `/pets` | Hunter-only. | Reachable from `/bis` Hunter follow-up. |
| `/spellcoef` | Grouped by effect type, `_unverified_` flags, parenthetical meta suffix (C3). Clean degrade for melee classes. | Caster/hybrid follow-up from `/bis`. |
| `/quest` | XP-risk flags. Watch field-value length (C1). | Pagination if list grows. |
| `/guide` | **Only paginated command.** `renderGuide` slices `SECTIONS_PER_PAGE=5`; footer hints `next: /guide slug:… page:N`. `renderGuideIndex` is the catalogue. Already truncates. | Prev/Next page buttons (stateless `p1|guide|<slug>|<page>`), replacing the footer hint. Guide select on the index. |
| `/tierlist` | Static reference. | Reference panel button. |
| `/xprules` | Static reference (one-step). | Reference panel button `p1|xprules`. |
| `/optimize` | Compute path. Watch length (C1). | — |

---

## Button / pagination strategy

Aligned with `08-enduser-panels.md`:

1. **Widen the render signature** from `{ embeds }` to `{ embeds, components }`.
   Services optionally return components; slash handlers and panel handlers both
   pass them straight through. Backwards-compatible (missing `components` = none).
2. **Stateless customId pagination** — the page/context travels in the customId,
   never server memory: `p1|guide|<slug>|<page>`, `p1|enchant|<slot>|<page>`.
   Same `p1|<action>|<arg>` schema as the panels doc, ≤100 chars, slug-only.
3. **Component router** in `interactionCreate` (see `08` "Component module +
   router"): parse customId, verify `p1`, dispatch by action. One router serves
   both the panels and slash-reply buttons.
4. **Who can click a slash-reply's buttons?** Two options — decide before Phase 1:
   - (a) public reply + gate button handlers to the original invoker, or
   - (b) ephemeral follow-ups (like panels).
   Panels are already all-ephemeral; matching that for slash-reply buttons keeps
   one mental model. **Open question — confirm before building components.**
5. **Component lifetime**: message components work indefinitely *as long as the
   router recognizes the customId* (stateless). No collector timeouts needed —
   this is the same mechanic panels rely on.
6. **Prioritize related-data cross-nav** (bis→enchant→consumable) over
   pagination; most lists fit in 25 fields today.

---

## Recommended sequencing

### Phase 0 — pure formatting, no components (do now)
- **C1**: shared `src/lib/embed.js` with `truncate()` + `fieldValue()` guard;
  refactor `guide.js` onto it; route all services' field values through it.
- **`/item`**: `setURL()` the title to the Wowhead page, delete the raw-URL
  field, link the Alternatives names.
- **`/enchant`**: move the enchant name into the value line as a masked link;
  keep no-level-req as its own line.
- **C3**: standardize the title meta-suffix (parenthetical) via a `metaTitle()`
  helper.
- **C4**: distinct degrade color via a `DEGRADE_COLOR` + shared degrade helper.
- **`/bis`**: fix the duplicate "Other builds" line (faction filter + dedupe).

### Phase 1 — component foundation
- Widen render signature to `{ embeds, components }`.
- Add the `interactionCreate` component router + `src/components/` loader.
- `deferReply()` on data commands (C5).
- Resolve the invoker-gating vs ephemeral question (strategy #4).

### Phase 2 — pagination buttons
- Guide Prev/Next first (already paginated), then enchant / consumable / quest
  overflow.

### Phase 3 — related-data buttons
- `/bis` & `/class` follow-ups (enchant/consumable/statweights/spellcoef/pets),
  `/item` → builds-using-this.

### Phase 4 — panels
- Post the persistent panel surface per `08-enduser-panels.md`, reusing the same
  render layer and router.
