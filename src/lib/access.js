import { MessageFlags, PermissionFlagsBits } from 'discord.js';

/**
 * Legacy role *name* gate. Kept only as a fallback for deployments that haven't
 * configured `DISCORD_ADMIN_ROLE_IDS` yet — matching a role by name is weak
 * (anyone able to create/rename a role can self-escalate), so it's disabled the
 * moment real role IDs are configured.
 */
export const LEGACY_DEV_ROLE_NAME = 'dev';

/**
 * Parse the optional admin role-ID allow-list from the environment. Read straight
 * from `process.env` at call time — deliberately NOT via the validated
 * `config/env.js`, whose module body throws on a missing `DISCORD_TOKEN`; going
 * through it would break this module (and its unit tests) with no secrets present.
 * Mirrors the same decoupling in `logger.js` / `audit.js`.
 */
function adminRoleIds() {
  return (process.env.DISCORD_ADMIN_ROLE_IDS?.trim() || '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
}

/**
 * True if the member may use admin/dev commands. Layered, strongest first:
 *   1. Holds Discord's Manage Server permission — server owners/admins always
 *      qualify; enforced server-side by Discord, unforgeable.
 *   2. Holds any role ID in `DISCORD_ADMIN_ROLE_IDS` — IDs survive renames, so
 *      this is the real fix for weak role-*name* auth.
 *   3. Fallback ONLY when no admin role IDs are configured: holds a role named
 *      "dev" (case-insensitive). Once IDs are set this weak path is off, so a
 *      forged/renamed "dev" role can no longer escalate.
 */
export function hasAdminAccess(member) {
  if (!member) return false;
  if (member.permissions?.has?.(PermissionFlagsBits.ManageGuild)) return true;
  const roles = member.roles?.cache;
  const ids = adminRoleIds();
  if (ids.length) return Boolean(roles?.some?.((r) => ids.includes(r.id)));
  return Boolean(roles?.some?.((r) => r.name?.toLowerCase() === LEGACY_DEV_ROLE_NAME));
}

/**
 * Gate a command on admin access. On failure, replies ephemerally and returns
 * false, so callers can `if (!(await requireAdmin(interaction))) return;`.
 */
export async function requireAdmin(interaction) {
  if (hasAdminAccess(interaction.member)) return true;
  await interaction.reply({
    content: 'You need the **Manage Server** permission or an admin role to use this command.',
    flags: MessageFlags.Ephemeral
  });
  return false;
}
