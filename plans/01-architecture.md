# Architecture

Target stack and structure for TwinkHub. Nothing here is built yet; this is the shape we
commit to before writing code.

## Stack

- **Runtime:** Node.js ≥ 20 (LTS). ES modules (`"type": "module"`).
- **Library:** discord.js v14 (`GatewayIntentBits`, `SlashCommandBuilder`,
  `REST`/`Routes` for command registration, `EmbedBuilder`, component v2 where useful).
- **Persistence:** flat JSON on disk for v1 (per-guild config + content store). A DB
  (SQLite via better-sqlite3, or Postgres) is a later option once write-features arrive —
  see `07-roadmap.md`. Keep a storage abstraction so this swap is localized.
- **Scheduling:** a single `setInterval` "tick" (default 60s) drives the timer module,
  mirroring the once-a-minute `tasks.loop` in `wow-timers`. No external cron.
- **Time:** all event schedules computed in `America/Denver` (Mountain), DST-safe. Use
  `luxon` (`DateTime` + IANA zones) — the JS analogue of Python's `zoneinfo`. This matches
  the `wow-timers` convention exactly (`MT = America/Denver`).
- **Config/secrets:** `.env` (via `dotenv`) — bot token, application id, log level.
- **Logging:** structured logger (pino or a thin wrapper) to `logs/twinkhub.log` with
  rotation. Single log file — we're one process now, not four.

## Intents

Only what we need:

- `Guilds` — base.
- `GuildMembers` (**privileged**) — required so `role.members` is populated for the DM
  fan-out (same reason `wow-timers` sets `intents.members = True`). Must be enabled in the
  Dev Portal for the app. Without it, role-holder DMs silently reach nobody.
- `GuildMessages` only if we ever read message content (we don't plan to). No
  `MessageContent` intent — everything is slash commands.

## Proposed source tree (to build later — do NOT scaffold yet)

```
TwinkHub/
├── package.json                 # stub now; deps added at build time
├── .env                         # not committed
├── plans/                       # <-- this spec
├── src/
│   ├── index.js                 # client bootstrap, intents, login, tick loop start
│   ├── config/
│   │   ├── env.js               # load + validate env
│   │   └── guildConfig.js       # per-guild JSON I/O (load/save/set flags)
│   ├── lib/
│   │   ├── logger.js
│   │   ├── time.js              # MT zone, countdown formatting, edge/latch helpers
│   │   ├── access.js            # requireDevRole(), error handler (name-based gate)
│   │   └── delivery.js          # ping / broadcast / dm fan-out (3 modes; see §Delivery)
│   ├── commands/                # one file per top-level command; auto-loaded
│   │   ├── data/                # /gear /enchant /consumable /quest /class /bis ...
│   │   ├── timers/              # /events /nextevent (+ dev /testevent)
│   │   └── admin/               # /setup /alerts /brackets (dev-gated)
│   ├── timers/
│   │   ├── engine.js            # tick(): compute states, run edge detection, deliver
│   │   └── events/              # one module per event: bg, agm, dmf, stv
│   │       └── <event>.js       # getState(now) + message builders + delivery policy
│   ├── content/                 # loader + validator over the data store
│   │   ├── store.js             # load + index bracket/class-namespaced JSON
│   │   └── schema.js            # zod (or ajv) schemas; validate on boot
│   └── deploy-commands.js       # register slash commands with Discord (run on deploy)
├── data/
│   ├── config/                  # <guildId>.json  (runtime, per-guild)
│   └── content/                 # authored knowledge (see 03-data-model.md)
│       └── 19/ 29/ ...          # bracket-namespaced
└── logs/
```

## Command registration model

- Commands are defined with `SlashCommandBuilder` in `src/commands/**`, auto-discovered
  at boot into a `Collection`.
- **Registration** is an explicit step (`deploy-commands.js`) run on deploy — either
  guild-scoped (instant, for test server) or global (up to ~1h propagation). We do **not**
  re-register on every boot; that avoids the "This command is outdated" cache thrash the
  `wow-timers` bots trigger by calling `tree.sync()` each startup.
- Interaction routing: single `interactionCreate` handler → look up command → `execute()`.
  Autocomplete handlers live alongside each command (heavily used by data commands, e.g.
  item-name autocomplete).

## Delivery (three modes — carried over from `wow-timers/shared.py`)

The proven three-way split is preserved verbatim in intent:

1. **ping** — post to the configured channel and mention the alert role (`<@&roleId>`
   appended to the body). Used for advance warnings and for occurrence pings.
2. **broadcast** — post to the channel with **all mentions suppressed**
   (`allowedMentions: { parse: [] }`). Used for silent occurrence posts.
3. **dm** — DM every non-bot member holding the guild's alert role, skipping guilds with
   DMs disabled. Requires the GuildMembers intent. Forbidden (DMs closed) is caught and
   skipped per-recipient.

Each event declares which modes it fires and when (see `02-timers-module.md`).

## Access control

- `requireDevRole(interaction)` — allow only members holding a role **named** "dev"
  (case-insensitive, matched by name not ID → portable across servers). Failing the check
  returns a clean ephemeral reply. Direct port of `require_dev_role()` +
  `install_dev_error_handler` from `wow-timers`.
- Enduser data commands are **open to everyone**; only `admin/` and `timers/` test
  commands are dev-gated.

## Persistence detail (per-guild config)

`data/config/<guildId>.json`:

```json
{
  "alertChannelId": "…",
  "alertRoleId": "…",
  "dmEnabled": true,
  "activeBrackets": ["19"],
  "timers": { "bg": true, "agm": true, "dmf": true, "stv": true }
}
```

- `dmEnabled` optional, **defaults true**; preserved across re-`/setup` (same semantics as
  `wow-timers`).
- `activeBrackets` gates which content namespaces the data commands expose in that guild
  (default `["19"]`).
- `timers.<event>` lets a guild disable individual event alerts.
