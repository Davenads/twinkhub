import { promises as fs } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { logger } from '../lib/logger.js';

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
  let raw;
  try {
    raw = await fs.readFile(file, 'utf8');
  } catch (err) {
    if (err.code === 'ENOENT') return {};
    throw err;
  }
  try {
    return JSON.parse(raw);
  } catch (err) {
    logger.warn({ err, file }, 'latch file unreadable; re-seeding latches');
    return {};
  }
}

/**
 * Persist the latch map, creating the directory if needed. Writes to a temp file
 * then atomically renames it into place (uv rename uses MOVEFILE_REPLACE_EXISTING
 * on Windows), so a crash mid-write can never leave a truncated/zero-filled
 * latch file — the on-disk file is always either the old or the new complete map.
 */
export async function saveLatches(latches, file = LATCH_FILE) {
  await fs.mkdir(path.dirname(file), { recursive: true });
  const tmp = `${file}.${process.pid}.tmp`;
  await fs.writeFile(tmp, JSON.stringify(latches, null, 2));
  await fs.rename(tmp, file);
}
