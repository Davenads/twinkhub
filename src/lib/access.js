import { MessageFlags, PermissionFlagsBits } from 'discord.js';
import { loadGuildConfig } from '../config/guildConfig.js';

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

/**
 * Read a role-ID list out of a guild's stash config block. Tolerates a null/absent
 * `stash` (unconfigured guild) or a non-array value — always returns a string[].
 */
function stashRoleIds(cfg, key) {
  const ids = cfg?.stash?.[key];
  return Array.isArray(ids) ? ids.filter(Boolean) : [];
}

/** True if the member holds any of the given role IDs. */
function hasAnyRole(member, ids) {
  if (!ids.length) return false;
  return Boolean(member?.roles?.cache?.some?.((r) => ids.includes(r.id)));
}

/**
 * Pure Manager predicate. Manage Server always qualifies (unforgeable, enforced
 * server-side); otherwise the member must hold a role listed in the guild's
 * `stash.managerRoleIds`. Kept separate from the bot-admin allow-list so a Manager
 * runs the stash without full bot-admin power. `cfg` is a loaded guild config.
 */
export function hasManagerAccess(member, cfg) {
  if (!member) return false;
  if (member.permissions?.has?.(PermissionFlagsBits.ManageGuild)) return true;
  return hasAnyRole(member, stashRoleIds(cfg, 'managerRoleIds'));
}

/**
 * Pure Requester predicate. Passes for anyone who can manage (managers are guildies
 * too and can self-add/approve anyway) OR who holds a configured
 * `stash.requesterRoleIds` (Twink) role. Browsing is open; this only gates requests.
 */
export function hasRequesterAccess(member, cfg) {
  if (!member) return false;
  if (hasManagerAccess(member, cfg)) return true;
  return hasAnyRole(member, stashRoleIds(cfg, 'requesterRoleIds'));
}

/**
 * Gate a command on Manager access for the interaction's guild. Manager/Twink roles
 * are per-guild *config* (not env like the admin allow-list), so this loads the guild
 * config then applies the pure predicate. On failure replies ephemerally and returns
 * false, so callers can `if (!(await requireManager(interaction))) return;`.
 * `loadConfig` is injectable for secretless unit tests.
 */
export async function requireManager(interaction, { loadConfig = loadGuildConfig } = {}) {
  const cfg = await loadConfig(interaction.guildId);
  if (hasManagerAccess(interaction.member, cfg)) return true;
  await interaction.reply({
    content:
      'You need the **Manage Server** permission or a configured Stash Manager role to use this.',
    flags: MessageFlags.Ephemeral
  });
  return false;
}

/**
 * Gate a command on Requester access (Twink role, or Manager/Manage Server). Same
 * per-guild config load + injectable loader as `requireManager`.
 */
export async function requireRequester(interaction, { loadConfig = loadGuildConfig } = {}) {
  const cfg = await loadConfig(interaction.guildId);
  if (hasRequesterAccess(interaction.member, cfg)) return true;
  await interaction.reply({
    content: 'You need a configured Twink/requester role to request items from the stash.',
    flags: MessageFlags.Ephemeral
  });
  return false;
}
