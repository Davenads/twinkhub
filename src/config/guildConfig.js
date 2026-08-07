import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { readText, writeJson, withLock } from '../storage/fileStore.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const CONFIG_DIR = path.resolve(__dirname, '../../data/config');

/** Defaults applied on read; new keys added here are backfilled automatically. */
export const DEFAULT_CONFIG = {
  alertChannelId: null,
  alertRoleId: null,
  dmEnabled: true,
  activeBrackets: ['19'],
  timers: { bg: true, agm: true, dmf: true, stv: true },
  // Persistent auto-updating dashboard message; null until /timerboard is run.
  timerBoard: null, // { channelId, messageId }
  // Persistent interactive enduser panels; null until /panels post is run.
  panels: null // { channelId, messageIds: { <panelKey>: messageId } }
};

function fileFor(guildId, dir = CONFIG_DIR) {
  return path.join(dir, `${guildId}.json`);
}

/**
 * Load a guild's config merged over defaults. Missing file => defaults. A corrupt
 * file fails loud (parse error propagates): unlike the regenerable latch file this
 * holds unrecoverable wiring (alert channel/role, board + panel message ids), so a
 * silent re-seed would permanently wipe a guild's setup — better to surface it.
 */
export async function loadGuildConfig(guildId, { dir = CONFIG_DIR } = {}) {
  const raw = await readText(fileFor(guildId, dir));
  if (raw == null) return { ...DEFAULT_CONFIG };
  return { ...DEFAULT_CONFIG, ...JSON.parse(raw) };
}

/**
 * Merge `patch` into a guild's config and persist atomically under the guild's
 * lock. `patch` may be an object (shallow-merged) or an updater `(current) =>
 * delta` — use the updater form to compute a merge against the fresh, under-lock
 * state (so sibling fields aren't lost). The lock keyed by absolute path serializes
 * racing writers (e.g. the per-tick board updater vs an admin toggle) and the
 * atomic write can't leave a truncated config. Returns the saved config.
 */
export async function saveGuildConfig(guildId, patch, { dir = CONFIG_DIR } = {}) {
  const file = fileFor(guildId, dir);
  return withLock(file, async () => {
    const current = await loadGuildConfig(guildId, { dir });
    const delta = typeof patch === 'function' ? patch(current) : patch;
    const next = { ...current, ...delta };
    await writeJson(file, next);
    return next;
  });
}

/** Convenience toggle for the per-guild DM fan-out flag. */
export async function setDmEnabled(guildId, enabled) {
  return saveGuildConfig(guildId, { dmEnabled: Boolean(enabled) });
}

/** Pure: merge a single event toggle into a timers map without clobbering siblings. */
export function mergeTimers(current = {}, event, enabled) {
  return { ...current, [event]: Boolean(enabled) };
}

/** Set one event's alert toggle for a guild, preserving the other toggles. The
 *  functional patch computes the merged timers map against the under-lock state,
 *  so concurrent toggles for the same guild can't drop each other. */
export async function setEventEnabled(guildId, event, enabled) {
  return saveGuildConfig(guildId, (cfg) => ({ timers: mergeTimers(cfg.timers, event, enabled) }));
}

/** Point (or clear with null) the persistent timer-board message for a guild. */
export async function setTimerBoard(guildId, board) {
  return saveGuildConfig(guildId, { timerBoard: board ?? null });
}

/** Point (or clear with null) the persistent enduser-panels record for a guild. */
export async function setPanels(guildId, panels) {
  return saveGuildConfig(guildId, { panels: panels ?? null });
}
