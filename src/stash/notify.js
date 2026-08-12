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

// Requester-facing DM copy per decision kind. Pure so it unit-tests without a
// client. Unknown kinds return null so the caller can skip silently. `item` may
// be null (deleted/racy) — we fall back to the raw item id.
const DM_LINES = {
  approved: (name, req) =>
    `Your stash request for ${name} was **approved** \u2014 a manager will hand it over soon. (request \`${req.id}\`)`,
  sent: (name, req) =>
    `Your stash request for ${name} was marked **sent** \u2014 enjoy! (request \`${req.id}\`)`,
  denied: (name, req) => `Your stash request for ${name} was **denied**. (request \`${req.id}\`)`,
  expired: (name, req) =>
    `Your approved stash request for ${name} wasn't picked up in time and was returned to the pending queue \u2014 a manager can re-approve it. (request \`${req.id}\`)`
};

/**
 * Pure builder for the requester DM payload on a request decision. Returns
 * `{ content, allowedMentions: { parse: [] } }` or `null` for an unknown kind.
 */
export function buildRequesterDM({ kind, item, req }) {
  const line = DM_LINES[kind];
  if (!line) return null;
  const name = item?.name ? `**${item.name}**` : `item \`${req.itemId}\``;
  return { content: truncate(line(name, req), LIMITS.description), allowedMentions: { parse: [] } };
}

async function dmUserDefault(client, userId, payload) {
  const user = await client.users.fetch(userId);
  await user.send(payload);
}

/**
 * DM the requester about a decision on their request. No-op for an unknown kind.
 * Never throws — closed DMs / left-server are logged and swallowed so the
 * manager's action path stays unaffected.
 *
 * `getItem` and `dmUser(userId, payload)` are injectable for secretless tests.
 *
 * @param {import('discord.js').Client} client
 */
export async function notifyRequester(
  client,
  guildId,
  { req, kind },
  { getItem = store.getItem, dmUser } = {}
) {
  if (!DM_LINES[kind]) return;
  let item = null;
  try {
    item = await getItem(guildId, req.itemId);
  } catch {
    // fall back to the raw item id in the DM
  }
  const payload = buildRequesterDM({ kind, item, req });
  if (!payload) return;
  const sink = dmUser ?? ((uid, p) => dmUserDefault(client, uid, p));
  try {
    await sink(req.userId, payload);
  } catch (err) {
    logger.warn({ err, guildId, userId: req.userId, kind }, 'stash notify: requester DM failed');
  }
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
