import { loadGuildConfig } from '../config/guildConfig.js';
import { renderMessage } from './messages.js';
import { sendPing, sendBroadcast, sendDms } from '../lib/delivery.js';
import { logger } from '../lib/logger.js';

/**
 * Build the engine's `dispatch` callback: given one fired trigger (global, one
 * per occurrence/warning), fan it out to every guild the bot is in that has the
 * event enabled and an alert channel + role configured.
 *
 * Per guild the trigger's delivery `policy` decides the channel mode
 * (`ping` vs silent `broadcast`) and whether to DM the alert-role holders
 * (gated additionally by the guild's `dmEnabled`). Every guild is isolated in a
 * try/catch so one misconfigured server can't block deliveries to the rest.
 *
 * `loadConfig` is injectable for testing; it defaults to the on-disk per-guild
 * config loader.
 *
 * The returned `dispatch(fire)` resolves to a per-guild results array
 * (`[{ guildId, channelDelivered, dmsSent }]`) covering every guild that passed
 * the config gates — used by `/testevent` to report what actually happened. Pass
 * `fire.onlyGuildId` to scope delivery to a single guild (the live tick omits it
 * to fan out to all; a dev test scopes it to the invoking guild so it can't spam
 * every configured server).
 *
 * @param {import('discord.js').Client} client
 * @param {{ loadConfig?: (guildId: string) => Promise<object> }} [opts]
 */
export function createDispatch(client, { loadConfig = loadGuildConfig } = {}) {
  return async function dispatch({ event, kind, policy, state, onlyGuildId = null }) {
    const body = renderMessage(event, kind, state);
    if (!body) return []; // nothing to say for this combination

    const results = [];

    for (const guild of client.guilds.cache.values()) {
      if (onlyGuildId && guild.id !== onlyGuildId) continue;

      let cfg;
      try {
        cfg = await loadConfig(guild.id);
      } catch (err) {
        logger.warn({ err, guild: guild.id }, 'timer dispatch: config load failed');
        continue;
      }

      if (!cfg.alertChannelId || !cfg.alertRoleId) continue; // not set up
      if (cfg.timers?.[event] === false) continue; // event disabled here

      let channelDelivered = false;
      let dmsSent = 0;

      // Channel delivery (ping or silent broadcast).
      try {
        const channel =
          guild.channels.cache.get(cfg.alertChannelId) ??
          (await guild.channels.fetch(cfg.alertChannelId).catch(() => null));

        if (channel?.isTextBased?.()) {
          if (policy.channel === 'ping') {
            await sendPing(channel, cfg.alertRoleId, body);
          } else {
            await sendBroadcast(channel, body);
          }
          channelDelivered = true;
        } else {
          logger.warn(
            { guild: guild.id, channel: cfg.alertChannelId },
            'timer dispatch: alert channel missing or not text'
          );
        }
      } catch (err) {
        logger.warn({ err, guild: guild.id, event, kind }, 'timer dispatch: channel send failed');
      }

      // DM fan-out (only when the policy DMs AND the guild has DMs enabled).
      if (policy.dm && cfg.dmEnabled !== false) {
        try {
          const role =
            guild.roles.cache.get(cfg.alertRoleId) ??
            (await guild.roles.fetch(cfg.alertRoleId).catch(() => null));

          if (role) {
            dmsSent = await sendDms(role, body);
            logger.info(
              { guild: guild.id, event, kind, sent: dmsSent },
              'timer dispatch: DM fan-out'
            );
          }
        } catch (err) {
          logger.warn({ err, guild: guild.id, event, kind }, 'timer dispatch: DM fan-out failed');
        }
      }

      results.push({ guildId: guild.id, channelDelivered, dmsSent });
    }

    return results;
  };
}
