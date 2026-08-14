-- Community Stash: partial unique index sealing the duplicate-item class shut.
--
-- Enforces one *active* row per (guild_id, wowhead_id) so an id-bearing item can
-- never be double-entered again. "Active" excludes 'withdrawn' rows, so retired
-- dupes (and the withdrawn tombstones the consolidation script leaves behind)
-- don't count against the constraint — a fresh donation can reuse the same
-- wowhead_id after the prior row is given/withdrawn.
--
-- Deliberately NOT enforced here:
--   * null wowhead_id rows — linkless donations are legitimate and would all
--     collide on a plain unique index; identity for those stays app-side.
--   * name uniqueness — case/whitespace variance plus legit same-name items
--     (different enchants, etc.) make a DB-level name rule wrong; findItemMatch
--     handles name identity in src/stash/store.js.
--
-- APPLY ORDER (operator, via Supabase CLI `db push` — NEVER at bot boot):
-- this index FAILS TO BUILD while two active rows share a wowhead_id. Run the
-- consolidation script first and confirm a clean report, THEN db push:
--   npm run stash:consolidate -- --guild <guildId>            # dry-run, expect none
--   npm run stash:consolidate -- --guild <guildId> --apply    # if any remain
--   supabase db push                                          # build the index

create unique index if not exists stash_items_guild_wowhead_active_idx
  on stash_items (guild_id, wowhead_id)
  where wowhead_id is not null and status in ('available', 'requested', 'given');
