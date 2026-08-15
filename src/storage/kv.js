import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { readText, writeJson, withLock } from './fileStore.js';

/**
 * Logical key/value storage seam — the boundary every durable, mutable piece of
 * state crosses. Callers address state by an opaque *logical key*
 * (`config/<guildId>`, `timers/latches`) instead of a filesystem path, so the
 * backing store can be swapped without touching call sites. That indirection is
 * the prerequisite for moving off the ephemeral dyno filesystem (Heroku): a
 * future Postgres/KV backend, selected here, keys its rows by the same logical
 * string. Callers must therefore never assume a key maps to a path.
 *
 * Today the only backend is the file backend (storage/fileStore.js), which owns
 * the atomic temp-write-then-rename and the in-process lock; this module just
 * resolves a logical key to a JSON file under `data/` and delegates.
 */

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// Root for the file backend. Production keys resolve under here exactly as the
// pre-seam paths did (`config/<id>` -> data/config/<id>.json, `timers/latches`
// -> data/timers/latches.json), so this refactor is a no-op on disk.
const DEFAULT_DATA_DIR = path.resolve(__dirname, '../../data');

/**
 * Map a logical key to its JSON file under `baseDir` (default: the repo `data/`).
 * `baseDir` is a file-backend-only override used by tests to isolate from the
 * real data dir; a DB backend would ignore it. Rejects absolute/traversal keys so
 * a key can never escape the data root.
 */
function resolvePath(key, baseDir) {
  if (typeof key !== 'string' || !key || key.includes('..') || path.isAbsolute(key)) {
    throw new Error(`invalid storage key: ${key}`);
  }
  return path.join(baseDir ?? DEFAULT_DATA_DIR, `${key}.json`);
}

/** Read a logical key's raw contents. Missing => null; parsing is the caller's policy. */
export async function readKey(key, { baseDir } = {}) {
  return readText(resolvePath(key, baseDir));
}

/** Atomically persist a JSON value at a logical key (creating parent dirs). */
export async function writeKey(key, value, { baseDir } = {}) {
  return writeJson(resolvePath(key, baseDir), value);
}

/**
 * Serialize a read-modify-write against a logical key. Keyed by the logical key
 * (not the resolved path), so two writers to the same key always contend
 * regardless of backend or baseDir. In-process only — correct for the single-fork
 * pm2 model; a DB backend would replace this with a row transaction.
 */
export function lockKey(key, fn) {
  return withLock(key, fn);
}
