import { logger } from '../lib/logger.js';
import { readKey, writeKey } from '../storage/kv.js';

/**
 * Global (not per-guild) latch storage key. Timer schedules are realm-time-wide
 * and identical for every guild, so edge/warning latches are tracked once per event
 * process-wide and fanned out to guilds at delivery time. Resolves to
 * data/timers/latches.json under the file backend.
 */
export const LATCH_KEY = 'timers/latches';

/**
 * Load the latch map. Missing => empty map (triggers a clean seed). A
 * present-but-corrupt blob (e.g. zero-filled by a crash mid-write) also re-seeds
 * clean instead of throwing: `loadLatches` runs every tick, so a thrown parse
 * error would abort the whole timer engine on every tick and silently halt all
 * alert dispatch. The next tick's `saveLatches` immediately rewrites valid JSON,
 * so the corruption self-heals; we log once so the event is visible. `baseDir`
 * overrides the storage base dir (tests only).
 */
export async function loadLatches({ baseDir } = {}) {
  const raw = await readKey(LATCH_KEY, { baseDir });
  if (raw == null) return {};
  try {
    return JSON.parse(raw);
  } catch (err) {
    logger.warn({ err, key: LATCH_KEY }, 'latch file unreadable; re-seeding latches');
    return {};
  }
}

/**
 * Persist the latch map. The atomic temp-write-then-rename (see fileStore)
 * guarantees a crash mid-write can never leave a truncated/zero-filled latch file
 * — the on-disk file is always either the old or the new complete map. `baseDir`
 * overrides the storage base dir (tests only).
 */
export async function saveLatches(latches, { baseDir } = {}) {
  await writeKey(LATCH_KEY, latches, { baseDir });
}
