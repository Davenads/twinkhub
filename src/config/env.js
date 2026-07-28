import 'dotenv/config';

function required(name) {
  const v = process.env[name];
  if (!v || !v.trim()) {
    throw new Error(`Missing required env var: ${name} (set it in .env — see .env.example)`);
  }
  return v.trim();
}

/**
 * Validated environment. Importing this module throws fast if a required
 * secret is missing, so `npm start` / `npm run deploy` fail with a clear message
 * rather than deep inside the Discord client.
 */
export const env = {
  token: required('DISCORD_TOKEN'),
  appId: required('DISCORD_APP_ID'),
  devGuildId: process.env.DISCORD_DEV_GUILD_ID?.trim() || null,
  logLevel: process.env.LOG_LEVEL?.trim() || 'info'
};
