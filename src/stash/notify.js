import { EmbedBuilder } from 'discord.js';
import { EMBED_COLOR, field, truncate, LIMITS } from '../lib/embed.js';
import { loadGuildConfig } from '../config/guildConfig.js';
import { logger } from '../lib/logger.js';
import * as store from './store.js';

// Manager notification for a newly-filed stash request. When a guild sets a
// `stash.managerChannelId`, each new request posts one embed there and pings the
// configured Manager role(s) so approvals don't sit unseen. Opt-in: no channel
// => no notification. Fire-and-forget from the request path — a notify failure
// must never break or delay the requester's ephemeral confirmation.

/**
 * Pure builder for the manager notice payload. `item` may be null (deleted/racy)
 * — we fall back to the raw item id. Only the given manager role ids may ping:
 * `allowedMentions` is scoped to them so nothing else (users/@everyone) pings.
 */
export function buildRequestNotice({ item, req, requesterId, managerRoleIds = [] }) {
  const roles = Array.isArray(managerRoleIds) ? managerRoleIds.filter(Boolean) : [];
  const name = item?.name ?? `item \`${req.itemId}\``;
  const remaining = item?.remaining;
  const itemLine = remaining != null ? `${name} \u00d7${remaining} left` : name;

  const embed = new EmbedBuilder()
    .setColor(EMBED_COLOR)
    .setTitle('New stash request')
    .addFields(
      field('Item', itemLine, true),
      field('Requester', requesterId ? `<@${requesterId}>` : '\u2014', true),
      field('Request id', `\`${req.id}\``, true),
      field('Approve', `\`/stashadmin approve request_id:${req.id}\``, false)
    );

  const ping = roles.map((id) => `<@&${id}>`).join(' ');
  const content = truncate(ping ? `${ping} new stash request` : 'New stash request', LIMITS.title);

  return { content, embeds: [embed], allowedMentions: { roles } };
}

async function sendToChannel(client, channelId, payload) {
  const channel = await client.channels.fetch(channelId);
  if (!channel?.isTextBased?.() || typeof channel.send !== 'function') {
    logger.warn({ channelId }, 'stash notify: channel not a sendable text channel');
    return;
  }
  await channel.send(payload);
}

/**
 * Post a new-request notification for `req` to the guild's configured manager
 * channel. No-op when no `managerChannelId` is set. Never throws — every failure
 * is logged and swallowed so the request path stays unaffected.
 *
 * `loadConfig`, `getItem`, and `send(channelId, payload)` are injectable for
 * secretless unit tests.
 *
 * @param {import('discord.js').Client} client
 */
export async function notifyNewRequest(
  client,
  guildId,
  { req, requesterId },
  { loadConfig = loadGuildConfig, getItem = store.getItem, send } = {}
) {
  let cfg;
  try {
    cfg = await loadConfig(guildId);
  } catch (err) {
    logger.warn({ err, guildId }, 'stash notify: config load failed');
    return;
  }
  const channelId = cfg.stash?.managerChannelId;
  if (!channelId) return; // opt-in: no manager channel configured

  const managerRoleIds = Array.isArray(cfg.stash?.managerRoleIds) ? cfg.stash.managerRoleIds : [];
  let item = null;
  try {
    item = await getItem(guildId, req.itemId);
  } catch {
    // fall back to the raw item id in the notice
  }

  const payload = buildRequestNotice({ item, req, requesterId, managerRoleIds });
  const sink = send ?? ((cid, p) => sendToChannel(client, cid, p));
  try {
    await sink(channelId, payload);
  } catch (err) {
    logger.warn({ err, guildId, channelId }, 'stash notify: send failed');
  }
}
