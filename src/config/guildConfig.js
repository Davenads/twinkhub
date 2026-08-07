import { promises as fs } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

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
 * Write via a temp file + atomic rename so a crash mid-write can never leave a
 * truncated/zero-filled config. Unlike the regenerable latch file, this holds
 * unrecoverable wiring (alert channel/role, board + panel message ids), so a
 * partial write would permanently break a guild until manual re-setup.
 */
async function atomicWrite(file, data) {
  const tmp = `${file}.${process.pid}.tmp`;
  await fs.writeFile(tmp, data);
  await fs.rename(tmp, file);
}

/**
 * Per-file async mutex (promise chain). Serializes read-modify-write for a given
 * guild so concurrent saves — e.g. the per-tick board updater racing an admin
 * toggle — can't clobber each other's fields. In-process only, which is correct
 * for the single-fork pm2 model; a future Postgres move replaces it with a row
 * transaction. Keyed by absolute path so distinct guilds/dirs never contend.
 */
const _locks = new Map();
function withFileLock(file, fn) {
  const next = (_locks.get(file) ?? Promise.resolve()).then(fn, fn);
  _locks.set(
    file,
    next.catch(() => {})
  );
  return next;
}

/** Load a guild's config merged over defaults. Missing file => defaults. */
export async function loadGuildConfig(guildId, { dir = CONFIG_DIR } = {}) {
  try {
    const raw = await fs.readFile(fileFor(guildId, dir), 'utf8');
    return { ...DEFAULT_CONFIG, ...JSON.parse(raw) };
  } catch (err) {
    if (err.code === 'ENOENT') return { ...DEFAULT_CONFIG };
    throw err;
  }
}

/**
 * Merge `patch` into a guild's config and persist atomically under the guild's
 * lock. `patch` may be an object (shallow-merged) or an updater `(current) =>
 * delta` — use the updater form to compute a merge against the fresh, under-lock
 * state (so sibling fields aren't lost). Returns the saved config.
 */
export async function saveGuildConfig(guildId, patch, { dir = CONFIG_DIR } = {}) {
  const file = fileFor(guildId, dir);
  return withFileLock(file, async () => {
    await fs.mkdir(dir, { recursive: true });
    const current = await loadGuildConfig(guildId, { dir });
    const delta = typeof patch === 'function' ? patch(current) : patch;
    const next = { ...current, ...delta };
    await atomicWrite(file, JSON.stringify(next, null, 2));
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
