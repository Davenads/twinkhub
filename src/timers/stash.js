import { loadGuildConfig, setStash } from '../config/guildConfig.js';
import * as store from '../stash/store.js';
import { buildStashPanel } from '../services/stash.js';
import { notifyRequester } from '../stash/notify.js';
import { logger } from '../lib/logger.js';

// Discord API code for "Unknown Message" — the stored panel was deleted, so we
// repost a fresh one and re-persist its id (self-heal). Mirrors board.js.
const UNKNOWN_MESSAGE = 10008;

const SEND_OPTS = { allowedMentions: { parse: [] } };
const STASH_STATUSES = ['available', 'requested'];

// Fingerprint the panel's visible state so we only edit the message when what
// the panel actually shows changed (status + remaining + item membership).
// Avoids a needless per-minute edit on every guild that churns the channel's
// edit history and burns rate limit for no visible change.
export function stashFingerprint(items) {
  return items.map((it) => `${it.id}:${it.status}:${it.remaining}`).join('|');
}

/**
 * Build the tick's stash refresher: for every guild with a configured stash
 * panel, sweep stale approvals back to the queue, then re-render the public
 * panel in place — but only when its visible state changed since the last tick.
 *
 * No-ops entirely when the stash store is unconfigured (no DATABASE_URL), so it
 * costs nothing on deployments not using the stash. Each guild is isolated in
 * try/catch so one broken guild can't stall the others (mirrors board.js).
 *
 * Throttle trade-off: because we skip untouched guilds, a *deleted* panel only
 * self-heals on the next stock change (or a manual `/stashadmin panel refresh`),
 * not every tick — the deliberate cost of not editing when nothing changed.
 *
 * `loadConfig`, `saveStash`, `expire`, `listItems`, `build`, `isEnabled`, and
 * `notify` are injectable for secretless unit tests.
 *
 * @param {import('discord.js').Client} client
 */
export function createStashRefresher(
  client,
  {
    loadConfig = loadGuildConfig,
    saveStash = setStash,
    expire = store.expireStaleApprovals,
    listItems = store.listItems,
    build = buildStashPanel,
    isEnabled = store.isEnabled,
    notify = notifyRequester
  } = {}
) {
  // Per-process memo of the last rendered fingerprint per guild. Lost on restart
  // (harmless: the first post-restart tick simply edits once to re-sync).
  const lastFingerprint = new Map();

  return async function runStashRefresh({ now = new Date() } = {}) {
    if (!isEnabled()) return [];
    const results = [];

    for (const guild of client.guilds.cache.values()) {
      let cfg;
      try {
        cfg = await loadConfig(guild.id);
      } catch (err) {
        logger.warn({ err, guild: guild.id }, 'stash refresh: config load failed');
        continue;
      }

      const stash = cfg.stash;
      if (!stash?.channelId) continue; // no panel configured for this guild

      try {
        // Sweep first: revert approvals a manager never handed over within N days
        // so the reserved unit frees up before we render the (now-updated) stock.
        const { reverted, requests } = await expire(guild.id, {
          staleApprovalDays: stash.staleApprovalDays ?? 5,
          now
        });
        if (reverted) {
          logger.info({ guild: guild.id, reverted }, 'stash: reverted stale approvals');
          // Heads-up DM to each requester whose approval lapsed back to pending.
          // Fire-and-forget: a DM failure must never stall the panel refresh.
          for (const req of requests ?? []) {
            notify(client, guild.id, { req, kind: 'expired' }).catch(() => {});
          }
        }

        const items = await listItems(guild.id, { statuses: STASH_STATUSES });
        const fingerprint = stashFingerprint(items);
        if (lastFingerprint.get(guild.id) === fingerprint) {
          results.push({ guildId: guild.id, action: 'unchanged' });
          continue;
        }

        const channel =
          guild.channels.cache.get(stash.channelId) ??
          (await guild.channels.fetch(stash.channelId).catch(() => null));
        if (!channel?.isTextBased?.()) {
          logger.warn(
            { guild: guild.id, channel: stash.channelId },
            'stash refresh: channel missing or not text'
          );
          results.push({ guildId: guild.id, action: 'skipped' });
          continue;
        }

        const payload = { ...build({ items }), ...SEND_OPTS };
        const outcome = await editOrRepost(channel, stash.panelMessageIds?.browse, payload);
        if (outcome.action === 'reposted') {
          await saveStash(guild.id, { panelMessageIds: { browse: outcome.messageId } });
        }
        // Only memoize once the edit/repost actually landed, so a failed edit
        // retries next tick rather than being masked by a stored fingerprint.
        lastFingerprint.set(guild.id, fingerprint);
        results.push({ guildId: guild.id, ...outcome });
      } catch (err) {
        logger.warn({ err, guild: guild.id }, 'stash refresh: update failed');
        results.push({ guildId: guild.id, action: 'error' });
      }
    }

    return results;
  };
}

/**
 * Edit the stored panel message, or repost if it's gone. Only a deleted message
 * (UNKNOWN_MESSAGE) triggers a repost; any other failure bubbles so the caller
 * logs and skips instead of spamming a fresh panel on, e.g., a permissions error.
 */
async function editOrRepost(channel, messageId, payload) {
  if (messageId) {
    try {
      const msg = await channel.messages.fetch(messageId);
      await msg.edit(payload);
      return { action: 'edited', messageId: msg.id };
    } catch (err) {
      if (err?.code !== UNKNOWN_MESSAGE) throw err;
      // fall through: message was deleted, repost below
    }
  }
  const msg = await channel.send(payload);
  return { action: 'reposted', messageId: msg.id };
}
