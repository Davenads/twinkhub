# TwinkHub — project notes

WoW WSG-19 twinking Discord bot (discord.js v14, ESM). Handlers stay thin; game
knowledge lives in the JSON content store under `data/content/<bracket>/`, not in code.

## Commands / scripts
- `npm start` — run the bot (`node src/index.js`)
- `npm test` — `node --test` (unit tests under `test/`)
- `npm run deploy` — register slash commands (only when command *definitions* change)

Redeploy is NOT needed for presentational/content changes — only when a command's
name/options/description change. A code change requires restarting the bot process.

## Deployment / runtime

The bot runs under **pm2** on this Windows machine as app **`twinkhub`** (single fork
instance — see `ecosystem.config.cjs`). A Discord gateway bot must hold exactly one
connection per token, so never run a second instance alongside the pm2 one (it causes
duplicate replies and double timer pings).

Manage it:
- `pm2 start ecosystem.config.cjs` — start/adopt the bot under pm2
- `pm2 reload twinkhub` — zero-downtime restart after a code change
- `pm2 logs twinkhub` — tail logs
- `pm2 save` — snapshot the process list (required after add/remove for boot resurrect)

Boot persistence (survives reboot): `pm2-windows-startup` runs `pm2 resurrect` on login.
Install once: `npm i -g pm2-windows-startup && pm2-startup install`, then `pm2 save`.

Secrets live in `.env` (loaded by the app via dotenv) — never commit them or bake them
into pm2 config / the process list.

### Possible future migration — Heroku
We may move the bot to a **Heroku basic dyno with GitHub autodeploy** off `main`. Before
that migration, resolve these:
- Add a `Procfile`: `worker: node src/index.js` (a bot is a worker dyno, not `web`).
- Move `DISCORD_TOKEN` / guild ids from `.env` to Heroku **config vars**.
- **Durable storage:** Heroku's filesystem is *ephemeral* — anything written under
  `data/` (per-guild config, timer advance-warning latches) is wiped on every dyno
  restart/deploy. Move that mutable state to a real store (e.g. Heroku Postgres or an
  external KV) before cutover, or timers will double-fire and `/setup` will reset.
- Drop the local pm2 setup once Heroku owns the runtime (don't run both against the same
  bot token).
