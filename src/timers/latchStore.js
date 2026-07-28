import { promises as fs } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

/**
 * Global (not per-guild) latch file. Timer schedules are Mountain-Time-wide and
 * identical for every guild, so edge/warning latches are tracked once per event
 * process-wide and fanned out to guilds at delivery time.
 */
export const LATCH_FILE = path.resolve(__dirname, '../../data/timers/latches.json');

/** Load the latch map. Missing file => empty map (triggers a clean seed). */
export async function loadLatches(file = LATCH_FILE) {
  try {
    return JSON.parse(await fs.readFile(file, 'utf8'));
  } catch (err) {
    if (err.code === 'ENOENT') return {};
    throw err;
  }
}

/** Persist the latch map, creating the directory if needed. */
export async function saveLatches(latches, file = LATCH_FILE) {
  await fs.mkdir(path.dirname(file), { recursive: true });
  await fs.writeFile(file, JSON.stringify(latches, null, 2));
}
