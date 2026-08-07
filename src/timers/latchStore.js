import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { logger } from '../lib/logger.js';
import { readText, writeJson } from '../storage/fileStore.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

/**
 * Global (not per-guild) latch file. Timer schedules are Mountain-Time-wide and
 * identical for every guild, so edge/warning latches are tracked once per event
 * process-wide and fanned out to guilds at delivery time.
 */
export const LATCH_FILE = path.resolve(__dirname, '../../data/timers/latches.json');

/**
 * Load the latch map. Missing file => empty map (triggers a clean seed). A
 * present-but-corrupt file (e.g. zero-filled by a crash mid-write) also re-seeds
 * clean instead of throwing: `loadLatches` runs every tick, so a thrown parse
 * error would abort the whole timer engine on every tick and silently halt all
 * alert dispatch. The next tick's `saveLatches` immediately rewrites valid JSON,
 * so the corruption self-heals; we log once so the event is visible.
 */
export async function loadLatches(file = LATCH_FILE) {
  const raw = await readText(file);
  if (raw == null) return {};
  try {
    return JSON.parse(raw);
  } catch (err) {
    logger.warn({ err, file }, 'latch file unreadable; re-seeding latches');
    return {};
  }
}

/**
 * Persist the latch map, creating the directory if needed. The atomic
 * temp-write-then-rename (see fileStore) guarantees a crash mid-write can never
 * leave a truncated/zero-filled latch file — the on-disk file is always either
 * the old or the new complete map.
 */
export async function saveLatches(latches, file = LATCH_FILE) {
  await writeJson(file, latches);
}
