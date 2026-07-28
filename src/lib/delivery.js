import { logger } from './logger.js';

// Discord API error code for "Cannot send messages to this user" (DMs closed /
// blocked). The Python port swallowed discord.Forbidden here; this is its code.
const DM_CLOSED = 50007;

/**
 * The three delivery modes carried over verbatim in intent from
 * `wow-timers/shared.py` (send_pings / send_broadcast / send_dms). These operate
 * on already-resolved discord.js channel/role objects so they stay free of any
 * guild-lookup or config concerns (that lives in `timers/dispatch.js`).
 */

/**
 * **ping** — post to the channel and mention the alert role. The role mention is
 * appended at the END of the body (single-space separator), matching the Python
 * trailing-mention format. `allowedMentions` is whitelisted to just the alert
 * role so nothing else in the body can ping.
 */
export async function sendPing(channel, roleId, body) {
  await channel.send({
    content: `${body} <@&${roleId}>`,
    allowedMentions: { roles: [roleId] }
  });
}

/**
 * **broadcast** — post to the channel with ALL mentions suppressed
 * (`allowedMentions: { parse: [] }`). Used for silent occurrence posts (AGM
 * spawn, STV start).
 */
export async function sendBroadcast(channel, body) {
  await channel.send({
    content: body,
    allowedMentions: { parse: [] }
  });
}

/**
 * **dm** — DM every non-bot member holding the alert role. Recipients with DMs
 * closed are silently skipped (matches the Python `discord.Forbidden` swallow).
 * Requires the GuildMembers intent so `role.members` is populated. Returns the
 * number of DMs actually sent.
 */
export async function sendDms(role, body) {
  let sent = 0;
  for (const member of role.members.values()) {
    if (member.user?.bot) continue;
    try {
      await member.send(body);
      sent += 1;
    } catch (err) {
      if (err?.code !== DM_CLOSED) {
        logger.warn({ err, member: member.id }, 'DM failed');
      }
    }
  }
  return sent;
}
