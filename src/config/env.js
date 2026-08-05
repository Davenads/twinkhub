import 'dotenv/config';

function required(name) {
  const v = process.env[name];
  if (!v || !v.trim()) {
    throw new Error(`Missing required env var: ${name} (set it in .env — see .env.example)`);
  }
  return v.trim();
}

/**
 * Parse the target guilds for slash-command registration. `DISCORD_GUILD_IDS`
 * (comma-separated) is preferred; falls back to the legacy single
 * `DISCORD_DEV_GUILD_ID`. Commands are always registered per-guild (instant) —
 * global registration is intentionally not supported.
 */
function parseGuildIds() {
  const raw =
    process.env.DISCORD_GUILD_IDS?.trim() || process.env.DISCORD_DEV_GUILD_ID?.trim() || '';
  return raw
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
}

/**
 * Validated environment. Importing this module throws fast if a required
 * secret is missing, so `npm start` / `npm run deploy` fail with a clear message
 * rather than deep inside the Discord client.
 */
export const env = {
  token: required('DISCORD_TOKEN'),
  appId: required('DISCORD_APP_ID'),
  guildIds: parseGuildIds(),
  logLevel: process.env.LOG_LEVEL?.trim() || 'info',
  // Optional: when set, every executed command and panel interaction is posted
  // as an audit embed to this channel. Unset (e.g. dev) disables audit logging.
  auditChannelId: process.env.AUDIT_LOG_CHANNEL_ID?.trim() || null
};
