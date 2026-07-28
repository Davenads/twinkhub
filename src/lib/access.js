import { MessageFlags } from 'discord.js';

/** Commands are gated by a role *named* this (case-insensitive), matched by name
 *  not ID so it's portable across servers. Ports wow-timers' require_dev_role. */
export const DEV_ROLE_NAME = 'dev';

/** True if the interaction's member holds a role named "dev". */
export function hasDevRole(member) {
  if (!member?.roles?.cache) return false;
  return member.roles.cache.some((r) => r.name.toLowerCase() === DEV_ROLE_NAME);
}

/**
 * Gate a command on the dev role. On failure, replies ephemerally and returns
 * false, so callers can `if (!(await requireDevRole(interaction))) return;`.
 */
export async function requireDevRole(interaction) {
  if (hasDevRole(interaction.member)) return true;
  await interaction.reply({
    content: `You need the **${DEV_ROLE_NAME}** role to use this command.`,
    flags: MessageFlags.Ephemeral
  });
  return false;
}
