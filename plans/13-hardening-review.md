# 13 — Hardening review roadmap

A prioritized, cross-session tracker for the full-project review. We work these
**one item at a time**: write a clear plan, get a "proceed", implement, then
`npm test` → commit → `git push origin main` → `pm2 reload twinkhub`. Redeploy
(`npm run deploy`) only when a command *definition* changes.

Status legend: `DONE` (shipped, commit noted) · `NEXT` (teed up) · `TODO`.

## P1 — Correctness / data-integrity (do first)

### P1 #1 — Guild config: atomic + race-safe writes — `DONE` (`41b30b9`)
`saveGuildConfig` funnels both the per-tick board updater (`setTimerBoard`) and
admin toggles through a read-modify-write whose awaits yield the loop, so two
racing writers could lose sibling fields; a non-atomic write could also truncate
a config on crash. Fix: in-process promise-chain mutex keyed by file path +
temp-write-then-rename (mirrors `latchStore`). `saveGuildConfig` now also accepts
a **functional patch** `(cfg) => delta` that reads fresh under-lock state, which
`setEventEnabled` delegates to. `loadGuildConfig` stays fail-loud on corrupt
files (atomic rename makes truncation unproducible; silent re-seed would wipe
unrecoverable wiring, unlike regenerable latches). Tests: round-trip over
defaults, concurrent sibling-field preservation, concurrent functional-patch
merge, no-temp-file-left-behind.

### P1 #2 — Timer tick: re-entrancy guard — `DONE` (this change)
A tick that outruns the 60s interval could overlap the next one, double-fanning
pings or racing shared latch/board writes. Extracted the inline `setInterval`
tick from `src/index.js` into a testable `createTickLoop({ runTick, intervalMs,
logger })` factory (`src/timers/loop.js`) that drops any tick arriving while the
previous is in flight (logs the skip) and owns the error boundary. `index.js`
now supplies a `runTick` and calls `.start()`. Tests in `test/timers/loop.test.js`
cover the overlap-skip (maxActive === 1), post-settle re-run, throw-then-recover,
and `stop()`.

## P2 — Reliability / infra

### P2 #3 — CI — `DONE` (this change)
Added `.github/workflows/ci.yml`: on push to `main` and on `pull_request`, runs
`actions/setup-node` (Node 20, npm cache) → `npm ci` → `npm test` on
`ubuntu-latest`, with a per-ref concurrency group that cancels an in-flight run
when a newer commit lands. Does **not** run `deploy`/`start` (those need
`DISCORD_TOKEN` and hit Discord). Now every push/PR is gated on the test suite.

**Follow-up fix (CI immediately earned its keep):** the first Linux CI run went red
where the suite is green locally. Cause was a test-isolation bug masked by the dev
`.env`: `test/lib/audit.test.js` → `audit.js` imported the validated `env`
(`../config/env.js`), whose module body throws on a missing `DISCORD_TOKEN`. With
no `.env` on the runner the whole file failed to load (the 1 failure + ~9 missing
tests). Fixed by decoupling `audit.js` from env *validation*: it now reads its one
optional var (`AUDIT_LOG_CHANNEL_ID`) straight from `process.env` at call time in
`postAudit`, mirroring `logger.js`'s existing rationale. `env.js`'s fail-fast for
the real entry points (`index.js`, `deploy-commands.js`) is untouched. Verified by
running the audit test with `DISCORD_TOKEN`/`DISCORD_APP_ID` unset.

### P2 #4 — Storage-adapter seam — `DONE` (this change)
Per-guild config (`config/guildConfig.js`) and timer latches (`timers/latchStore.js`)
each embedded their own `fs` calls, atomic temp-write-then-rename, and (config only)
a per-file promise-chain mutex. Factored the shared mechanics into one primitive —
`src/storage/fileStore.js` exposing `readText(key)` (raw string | `null` on ENOENT,
other IO errors throw), `writeJson(key, value)` (atomic, mkdir-p), and
`withLock(key, fn)` (per-key mutex). Both stores now delegate all filesystem access
through it; neither imports `node:fs` anymore. Each keeps its own path derivation
and its own read policy: guildConfig **fails loud** on a corrupt file (parse error
propagates — unrecoverable wiring), latchStore **self-heals** (logs + re-seeds — the
map is regenerable). Design note: the key is an absolute file path (not a
namespace/id), because the existing test seams pin leaf locations — guildConfig's
`{dir}` ⇒ `<dir>/<guildId>.json` and latchStore's `file` ⇒ that exact path — so a
root+namespace model couldn't reproduce both without rewriting those tests. A future
Postgres/KV backend implements the same three functions keyed by an opaque string
(keys become logical ids at cutover). All existing guildConfig/latchStore/timer tests
pass unchanged (the behavior-preserving proof); new `test/storage/fileStore.test.js`
covers missing-key null, verbatim (unparsed) read, atomic round-trip with no temp
left behind, parent-dir creation, and the mutex (serializes same-key, allows
distinct-key concurrency). 411 tests green. Unblocks the P4 Heroku durable-storage
prereq: swap `fileStore` for a `pgStore` without touching call sites.

## P3 — Housekeeping

### P3 #5 — Stray binary — `DONE` (this change)
`TwinkHub-consumable-icons.zip` (~54 KB, an emoji/icon upload bundle — one-time
asset, not runtime source) was untracked **and un-ignored** at repo root. Added a
`*.zip` rule to `.gitignore` so local asset archives stay out of git history and
out of untracked-status noise, keeping the local copy intact. Reversible: drop the
rule (or `git add -f`) if we ever want to commit it as an asset.

### P3 #6 — Route `latchStore` warn through pino — `DONE` (this change)
`latchStore.js` now logs the corrupt-read self-heal via the shared pino `logger`
(`logger.warn({ err, file }, 'latch file unreadable; re-seeding latches')`)
instead of `console.warn`, so the event carries structured `err`/`file` fields and
honors `LOG_LEVEL`/prod-vs-pretty transport like every other log. The corruption
test now spies on `logger.warn` rather than `console.warn`.

## P4 — Heroku migration prerequisites — `TODO`
Tracked in CLAUDE.md: `Procfile` (`worker: node src/index.js`), move
`DISCORD_TOKEN`/guild ids to config vars, durable storage (see P2 #4), drop local
pm2 once Heroku owns the runtime.

### P4 #7 — ESLint + Prettier — `DONE` (this change)
Added ESLint 9 flat config (`eslint.config.js`: JS-recommended + ESM + Node
globals, `no-unused-vars` with `^_` ignore; `eslint-config-prettier` last so lint
owns correctness and Prettier owns style) and Prettier (`.prettierrc.json` tuned to
the house style — printWidth 100, single quotes, semicolons, no trailing comma,
always-parens arrows; `.prettierignore` skips `node_modules/ data/ logs/ coverage/
package-lock.json` and all `*.md` prose docs). Scripts: `lint`, `lint:fix`,
`format`, `format:check`. ESLint came back clean (zero real issues); `prettier
--write` normalized the JS/test/tool/config files in one mechanical sweep
(semantically inert — the 405-test suite passed unchanged before and after).
Markdown is deliberately excluded so authored prose docs (README, CLAUDE.md,
these plans) aren't reflowed. CI now gates on `npm run lint` and
`npm run format:check` ahead of the test step.

## P5 — Security / auth

### P5 #9 — Admin access model — `TODO`
`src/lib/access.js` gates dev commands by **role name** `"dev"` (case-insensitive).
Role-name auth is weak (anyone who can create/rename a role escalates). Consider
role IDs from config, or Discord's native command permissions.

## P6 — Test coverage

### P6 #10 — Command-loader silent-skip test — `DONE` (this change)
`loadCommands` gained a `{ dir = __dirname }` test seam (production calls
unchanged) and now wraps each per-module `import()` in try/catch: a module that
throws on import is `logger.warn`'d and skipped instead of aborting the whole load
(one broken command no longer takes the bot offline — degrade in prod). Modules
that load but lack the `data.name`+`execute` shape are still quietly ignored.
`test/commands/loader.test.js` drives a temp fixture dir (marked
`{"type":"module"}` so `.js` resolves as ESM like the real scope) covering: only
well-formed commands register; a throw-on-import module is logged once and skipped
while the valid command still loads; empty dir → empty collection.

### P6 #11 — Guild config concurrency test — `DONE` (folded into P1 #1)
Shipped as part of P1 #1's test suite.
