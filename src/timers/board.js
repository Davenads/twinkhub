import { loadGuildConfig, setTimerBoard } from '../config/guildConfig.js';
import { renderEventsSummary } from './summary.js';
import { getContentStore } from '../content/store.js';
import { logger } from '../lib/logger.js';

// Discord API: the stored message no longer exists (deleted). Our cue to repost
// a fresh board rather than silently going stale.
const UNKNOWN_MESSAGE = 10008;

/**
 * Build the tick's board updater: for every guild with a configured timer board,
 * edit the stored message in place with the current event summary. If that
 * message was deleted, repost a fresh one and re-persist the new id (self-heal).
 *
 * The board content is identical MT-wide, so the payload is rendered once per
 * tick and reused across guilds. Each guild is isolated in try/catch so one
 * broken board can't stall the others. Mirrors dispatch.js's guild fan-out.
 *
 * `loadConfig`, `saveBoard`, and `render` are injectable for testing.
 *
 * @param {import('discord.js').Client} client
 * @param {{ loadConfig?: Function, saveBoard?: Function, render?: Function }} [opts]
 */
export function createBoardUpdater(
  client,
  {
    loadConfig = loadGuildConfig,
    saveBoard = setTimerBoard,
    render = renderEventsSummary,
    getStore = getContentStore
  } = {}
) {
  return async function updateBoards({ states, now = Date.now() }) {
    // Store powers the event icons; a load hiccup degrades to a text-only board.
    const store = await getStore().catch(() => null);
    const payload = { ...render(states, { now, store }), allowedMentions: { parse: [] } };
    const results = [];

    for (const guild of client.guilds.cache.values()) {
      let cfg;
      try {
        cfg = await loadConfig(guild.id);
      } catch (err) {
        logger.warn({ err, guild: guild.id }, 'timer board: config load failed');
        continue;
      }

      const board = cfg.timerBoard;
      if (!board?.channelId) continue; // no board configured for this guild

      const channel =
        guild.channels.cache.get(board.channelId) ??
        (await guild.channels.fetch(board.channelId).catch(() => null));

      if (!channel?.isTextBased?.()) {
        logger.warn(
          { guild: guild.id, channel: board.channelId },
          'timer board: channel missing or not text'
        );
        results.push({ guildId: guild.id, action: 'skipped' });
        continue;
      }

      try {
        const outcome = await editOrRepost(channel, board.messageId, payload);
        if (outcome.action === 'reposted') {
          await saveBoard(guild.id, { channelId: board.channelId, messageId: outcome.messageId });
        }
        results.push({ guildId: guild.id, ...outcome });
      } catch (err) {
        logger.warn({ err, guild: guild.id }, 'timer board: update failed');
        results.push({ guildId: guild.id, action: 'error' });
      }
    }

    return results;
  };
}

/**
 * Edit the stored board message, or repost if it's gone. Only a deleted message
 * (UNKNOWN_MESSAGE) triggers a repost; any other failure bubbles so the caller
 * logs and skips instead of spamming a fresh board on, e.g., a permissions error.
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
